// ABOUTME: WebSocket server for real-time game communication
// ABOUTME: Handles client connections, event routing, and room subscriptions

import { WebSocketServer, WebSocket } from 'ws'
import type { IncomingMessage } from 'http'
import {
  WSEvent,
  type JoinRoomPayload,
  type LeaveRoomPayload,
  type JoinQueuePayload,
  type LeaveQueuePayload,
  type SubmitClientSeedPayload,
  type PullTriggerPayload,
  type RoomUpdatePayload,
  type ErrorPayload,
} from '../../../shared/index.js'
import { roomManager } from '../game/room-manager.js'
import { queueManager } from '../game/queue-manager.js'
import { logger } from '../utils/logger.js'
import { checkWsRateLimit } from '../middleware/rate-limit.js'

interface Client {
  ws: WebSocket
  walletAddress: string | null
  subscribedRooms: Set<string>
}

export class WSServer {
  private wss: WebSocketServer
  private clients: Map<WebSocket, Client> = new Map()
  private broadcastInterval: NodeJS.Timeout | null = null

  constructor(port: number) {
    this.wss = new WebSocketServer({ port, maxPayload: 64 * 1024 })
    logger.info(`WebSocket server listening on port ${port}`)

    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      this.handleConnection(ws, req)
    })

    // Broadcast room updates periodically (with error handling)
    this.broadcastInterval = setInterval(() => {
      try {
        this.broadcastRoomUpdates()
      } catch (error: any) {
        logger.error('Room broadcast failed', { error: error?.message || String(error) })
      }
    }, 1000)
  }

  /**
   * Handle room created from queue - notify matched players
   */
  handleRoomCreatedFromQueue(roomId: string, playerAddresses: string[]): void {
    logger.info('Room created from queue, notifying players', { roomId, playerCount: playerAddresses.length })

    this.clients.forEach((client) => {
      if (client.walletAddress && playerAddresses.includes(client.walletAddress)) {
        // Subscribe client to the room
        client.subscribedRooms.add(roomId)

        // Send room:assigned event
        this.send(client.ws, {
          event: 'room:assigned',
          payload: { roomId }
        })
      }
    })
  }

  /**
   * Stop the WebSocket server and clean up resources
   */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      // Clear the broadcast interval
      if (this.broadcastInterval) {
        clearInterval(this.broadcastInterval)
        this.broadcastInterval = null
      }

      // Close all client connections
      this.clients.forEach((client) => {
        client.ws.close()
      })
      this.clients.clear()

      // Close the server
      this.wss.close(() => {
        logger.info('WebSocket server stopped')
        resolve()
      })
    })
  }

  private handleConnection(ws: WebSocket, req: IncomingMessage): void {
    // Extract IP address, handling proxied requests
    const forwardedFor = req.headers['x-forwarded-for']
    const ip = (typeof forwardedFor === 'string' ? forwardedFor.split(',')[0].trim() : forwardedFor?.[0])
      || req.socket.remoteAddress
      || 'unknown'

    // Check rate limit before accepting connection
    if (!checkWsRateLimit(ip)) {
      ws.close(1008, 'Rate limit exceeded')
      return
    }

    const client: Client = {
      ws,
      walletAddress: null,
      subscribedRooms: new Set(),
    }

    this.clients.set(ws, client)
    logger.debug(`WebSocket client connected`, { total: this.clients.size, ip })

    // Broadcast updated connection count to all clients
    this.broadcastConnectionCount()

    ws.on('message', (data: string) => {
      try {
        const message = JSON.parse(data.toString())
        this.handleMessage(ws, message)
      } catch (err) {
        logger.error('Failed to parse WebSocket message', { error: err })
        this.sendError(ws, 'Invalid message format')
      }
    })

    ws.on('close', () => {
      logger.debug(`WebSocket client disconnected`, { remaining: this.clients.size - 1 })

      // Handle room cleanup if player was in a room
      if (client.walletAddress && client.subscribedRooms.size > 0) {
        client.subscribedRooms.forEach(async (roomId) => {
          try {
            const room = roomManager.getRoom(roomId)
            if (!room) return

            if (room.state === 'LOBBY') {
              // LOBBY: safe to remove
              await roomManager.leaveRoom(roomId, client.walletAddress!)
              logger.info('Player removed from room due to disconnect', { walletAddress: client.walletAddress, roomId })
            } else if (room.state === 'FUNDING') {
              // FUNDING: keep seat, let room timeout naturally for refund safety
              // Don't abort on disconnect - user might reconnect or their deposit might arrive
              logger.info('Player disconnected during FUNDING, keeping seat', { walletAddress: client.walletAddress, roomId })
            } else if (room.state === 'PLAYING') {
              // PLAYING: do NOT forfeit on disconnect - player may be refreshing
              // The 30s turn timeout handles AFK players naturally
              logger.info('Player disconnected during PLAYING, keeping seat (may reconnect)', { walletAddress: client.walletAddress, roomId })
            }
          } catch (err) {
            logger.debug('Could not handle disconnected player', { walletAddress: client.walletAddress, roomId, error: err })
          }
        })
      }

      this.clients.delete(ws)

      // Broadcast updated connection count to all clients
      this.broadcastConnectionCount()
    })

    ws.on('error', (err) => {
      logger.error('WebSocket error', { error: err })
    })
  }

  private handleMessage(ws: WebSocket, message: any): void {
    const { event, payload } = message

    try {
      switch (event) {
        case WSEvent.JOIN_ROOM:
          this.handleJoinRoom(ws, payload as JoinRoomPayload)
          break

        case WSEvent.LEAVE_ROOM:
          this.handleLeaveRoom(ws, payload as LeaveRoomPayload)
          break

        case WSEvent.JOIN_QUEUE:
          this.handleJoinQueue(ws, payload as JoinQueuePayload)
          break

        case WSEvent.LEAVE_QUEUE:
          this.handleLeaveQueue(ws, payload as LeaveQueuePayload)
          break

        case WSEvent.SUBMIT_CLIENT_SEED:
          this.handleSubmitClientSeed(ws, payload as SubmitClientSeedPayload)
          break

        case WSEvent.PULL_TRIGGER:
          this.handlePullTrigger(ws, payload as PullTriggerPayload)
          break

        case 'subscribe_room':
          this.handleSubscribeRoom(ws, payload as { roomId: string; walletAddress: string })
          break

        default:
          this.sendError(ws, `Unknown event: ${event}`)
      }
    } catch (err: any) {
      logger.error(`Error handling WebSocket event`, {
        event,
        error: err.message || err,
        stack: err.stack,
        payload
      })
      this.sendError(ws, err.message || 'Internal server error')
    }
  }

  private handleJoinRoom(ws: WebSocket, payload: JoinRoomPayload): void {
    const { roomId, walletAddress } = payload
    const client = this.clients.get(ws)
    if (!client) return

    // Security: Once wallet is set, it cannot be changed for this connection
    if (client.walletAddress && client.walletAddress !== walletAddress) {
      this.sendError(ws, 'Wallet address cannot be changed for this connection')
      return
    }

    roomManager.joinRoom(roomId, walletAddress)
    client.walletAddress = walletAddress
    client.subscribedRooms.add(roomId)

    // Send room update to all subscribers
    this.broadcastRoomUpdate(roomId)
  }

  /**
   * Subscribe to room updates without joining (for reconnection after queue match)
   */
  private handleSubscribeRoom(ws: WebSocket, payload: { roomId: string; walletAddress: string }): void {
    const { roomId, walletAddress } = payload
    const client = this.clients.get(ws)
    if (!client) return

    const room = roomManager.getRoom(roomId)
    if (!room) {
      this.sendError(ws, 'Room not found')
      return
    }

    // Security: Once wallet is set, it cannot be changed for this connection
    if (client.walletAddress && client.walletAddress !== walletAddress) {
      this.sendError(ws, 'Wallet address cannot be changed for this connection')
      return
    }

    client.walletAddress = walletAddress
    client.subscribedRooms.add(roomId)

    // Send current room state to this client
    this.send(ws, {
      event: WSEvent.ROOM_UPDATE,
      payload: { room }
    })

    logger.debug('Client subscribed to room', { roomId, walletAddress })
  }

  private async handleLeaveRoom(ws: WebSocket, payload: LeaveRoomPayload): Promise<void> {
    const { roomId } = payload
    const client = this.clients.get(ws)
    if (!client) return

    // Security: Use stored wallet address from connection state, not from payload
    if (!client.walletAddress) {
      this.sendError(ws, 'Not authenticated - join a room or queue first')
      return
    }

    try {
      await roomManager.leaveRoom(roomId, client.walletAddress)
      client.subscribedRooms.delete(roomId)
      this.broadcastRoomUpdate(roomId)
    } catch (err: any) {
      this.send(ws, { event: 'error', payload: { message: err.message } })
    }
  }

  private handleJoinQueue(ws: WebSocket, payload: JoinQueuePayload): void {
    const { mode, seatPrice, walletAddress } = payload
    const client = this.clients.get(ws)
    if (!client) return

    // Security: Once wallet is set, it cannot be changed for this connection
    if (client.walletAddress && client.walletAddress !== walletAddress) {
      this.sendError(ws, 'Wallet address cannot be changed for this connection')
      return
    }

    client.walletAddress = walletAddress
    queueManager.joinQueue(walletAddress, mode, seatPrice)

    // Add bots to fill the queue if bot manager is enabled
    const botManager = (global as any).botManager
    if (botManager?.enabled && seatPrice) {
      botManager.addBotsToQueue(mode, seatPrice)
    }

    // Send confirmation (could include queue position)
    this.send(ws, {
      event: 'queue:joined',
      payload: { mode, seatPrice },
    })
  }

  private handleLeaveQueue(ws: WebSocket, _payload: LeaveQueuePayload): void {
    const client = this.clients.get(ws)
    if (!client) return

    // Security: Use stored wallet address from connection state, not from payload
    if (!client.walletAddress) {
      this.sendError(ws, 'Not authenticated - join a queue first')
      return
    }

    queueManager.leaveQueue(client.walletAddress)

    this.send(ws, {
      event: 'queue:left',
      payload: {},
    })
  }

  private handleSubmitClientSeed(ws: WebSocket, payload: SubmitClientSeedPayload): void {
    const { roomId, clientSeed } = payload
    const client = this.clients.get(ws)
    if (!client) return

    // Security: Use stored wallet address from connection state, not from payload
    if (!client.walletAddress) {
      this.sendError(ws, 'Not authenticated - join a room first')
      return
    }

    roomManager.submitClientSeed(roomId, client.walletAddress, clientSeed)

    this.broadcastRoomUpdate(roomId)
  }

  private handlePullTrigger(ws: WebSocket, payload: PullTriggerPayload): void {
    const { roomId } = payload
    const client = this.clients.get(ws)
    if (!client) return

    // Security: Use stored wallet address from connection state, not from payload
    if (!client.walletAddress) {
      this.sendError(ws, 'Not authenticated - join a room first')
      return
    }

    const result = roomManager.pullTrigger(roomId, client.walletAddress)

    if (!result.success) {
      this.sendError(ws, result.error || 'Failed to pull trigger')
    }
  }

  private broadcastRoomUpdate(roomId: string): void {
    const room = roomManager.getRoom(roomId)
    if (!room) return

    const payload: RoomUpdatePayload = { room }

    this.clients.forEach((client) => {
      if (client.subscribedRooms.has(roomId)) {
        this.send(client.ws, {
          event: WSEvent.ROOM_UPDATE,
          payload,
        })
      }
    })
  }

  private broadcastRoomUpdates(): void {
    // Broadcast updates for all active rooms
    const rooms = roomManager.getAllRooms()
    rooms.forEach((room) => {
      this.broadcastRoomUpdate(room.id)
    })
  }

  private send(ws: WebSocket, message: any): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message))
    }
  }

  private sendError(ws: WebSocket, message: string, code?: string): void {
    const payload: ErrorPayload = { message, code }
    this.send(ws, {
      event: WSEvent.ERROR,
      payload,
    })
  }

  /**
   * Broadcast a message to all connected clients
   */
  broadcast(event: string, payload: any): void {
    this.clients.forEach((client) => {
      this.send(client.ws, { event, payload })
    })
  }

  /**
   * Broadcast a message to all clients subscribed to a specific room
   */
  broadcastToRoom(roomId: string, event: string, payload: any): void {
    this.clients.forEach((client) => {
      if (client.subscribedRooms.has(roomId)) {
        this.send(client.ws, { event, payload })
      }
    })
  }

  /**
   * Broadcast unique user count to all connected clients
   * Counts unique wallet addresses (authenticated users) rather than raw connections
   * since a single user may have multiple connections (from different pages/tabs)
   */
  private broadcastConnectionCount(): void {
    const uniqueUsers = this.getUniqueUserCount()
    this.clients.forEach((client) => {
      this.send(client.ws, {
        event: 'connection:count',
        payload: { count: uniqueUsers }
      })
    })
  }

  /**
   * Get count of unique authenticated users
   * Only counts connections that have identified with a wallet address
   */
  private getUniqueUserCount(): number {
    const uniqueWallets = new Set<string>()
    this.clients.forEach((client) => {
      if (client.walletAddress) {
        uniqueWallets.add(client.walletAddress)
      }
    })
    return uniqueWallets.size
  }

  /**
   * Get unique authenticated user count
   */
  getConnectionCount(): number {
    return this.getUniqueUserCount()
  }

  /**
   * Get raw WebSocket connection count (for debugging/admin)
   */
  getRawConnectionCount(): number {
    return this.clients.size
  }

  /**
   * Get unique authenticated user count
   */
  getClientCount(): number {
    return this.getUniqueUserCount()
  }
}
