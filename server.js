import "dotenv/config";

import { DB_CONFIG, PORT } from "./config.js";

import express from "express";
import { WebSocketServer } from "ws";
import http from "http";
import { createGame, createPlayer } from "./engine/factories.js";

import pkg from "pg";
const { Pool } = pkg;

export const db = new Pool(DB_CONFIG);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// have express serve static assets from /public
app.use(express.static("public"));

// express and ws listening on port 3000
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export const wsToPlayerInfo = new Map();

let players = [];
let game;

export let loggedInPlayers = 0;

// dispatch map for intent coming via ws from client (renderers): maps to ss handlers
const handlers = {
  start_new_game: handleStartGame,
  click_number: handleClickNumber,
  undo_play: handleUndoPlay,
  get_stats: handleLegacyStats,
};

// what to do when a client hits the landing page
wss.on("connection", (ws) => {
  console.log("Client connected");

  // what to do when a client sends a ws message to the server
  ws.on("message", async (data) => {
    let message;
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }

    // when a client connects, it sends "init" intent and its clientId
    // that clientId is either pulled (in index.js) from local storage or generated
    if (message.type === "init") {
      const { clientId } = message;

      // Check DB for existing client
      const playerRecord = await db.query(
        "SELECT * FROM clients WHERE client_id = $1",
        [clientId],
      );

      let playerNumber;
      let alias;

      if (playerRecord.rowCount === 0) {
        // Get all used player_numbers from DB and active connections
        const dbNumbersRes = await db.query(
          "SELECT player_number FROM clients",
        );
        const dbNumbers = dbNumbersRes.rows.map((r) => r.player_number);
        const wsNumbers = Array.from(wsToPlayerInfo.values()).map(
          (p) => p.playerNumber,
        );
        const usedNumbers = [...new Set([...dbNumbers, ...wsNumbers])];

        // Assign the lowest available number
        playerNumber = 1;
        while (usedNumbers.includes(playerNumber)) {
          playerNumber++;
        }

        alias = `Player ${playerNumber}`;

        // Insert new client
        const result = await db.query(
          "INSERT INTO clients (client_id, alias, player_number) VALUES ($1, $2, $3) RETURNING *",
          [clientId, alias, playerNumber],
        );
        playerNumber = result.rows[0].player_number;
        alias = result.rows[0].alias;
      } else {
        playerNumber = playerRecord.rows[0].player_number;
        alias = playerRecord.rows[0].alias;
      }

      const player = createPlayer(alias);

      const statsRecord = await db.query(
        "SELECT games_played, games_won FROM player_stats WHERE client_id = $1",
        [clientId],
      );

      if (statsRecord.rowCount > 0) {
        player.setStats({
          gamesPlayed: statsRecord.rows[0].games_played,
          gamesWon: statsRecord.rows[0].games_won,
        });
      }

      wsToPlayerInfo.set(ws, {
        playerNumber,
        alias,
        clientId,
        player,
      });

      loggedInPlayers++;
      console.log(
        `Assigned ${alias} (#${playerNumber}) for clientId ${clientId}`,
      );

      return; // done with handshake
    }

    if (handlers[message.type]) {
      await handlers[message.type](ws, message);
    } else {
      console.warn("Unknown message type:", message.type);
    }
  });

  ws.on("close", () => {
    wsToPlayerInfo.delete(ws);
  });
});

async function handleStartGame(ws, message) {
  // Sort connections by playerNumber to ensure correct playerIndex
  players = Array.from(wsToPlayerInfo.values())
    .sort((a, b) => a.playerNumber - b.playerNumber)
    .map((info) => info.player);

  game = createGame(players);
  game.startNewGame();

  const state = game.getState();

  // Assign numbersPlayed to each player
  players.forEach((player, idx) => {
    player.numbersPlayed = state.numbersPlayed
      .filter((play) => play.playerIndex === idx)
      .map((play) => play.number);
  });
  
  const playersForClient = players.map((p) => ({
    playerName: p.getName(),
    numbersPlayed: p.numbersPlayed || [],
    gamesPlayed: p.getStats().gamesPlayed,
    gamesWon: p.getStats().gamesWon,
  }));

  // Broadcast ready_to_start to all clients
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) {
      client.send(
        JSON.stringify({
          type: "ready_to_start",
          players: playersForClient,
          currentPhase: state.currentPhase,
          numbersAvailable: state.numbersAvailable,
        }),
      );
    }
  }
}

async function handleClickNumber(ws, message) {
  const playerInfo = wsToPlayerInfo.get(ws);
  const playerNumber = playerInfo.playerNumber;
  const playerIndex = playerNumber - 1;

  const numberClicked = message.number;

  const result = game.playNumber(playerIndex, numberClicked);

  if (!result.success) return;

  const state = game.getState();

  players.forEach((player, idx) => {
    player.numbersPlayed = state.numbersPlayed
      .filter((play) => play.playerIndex === idx)
      .map((play) => play.number);
  });

  const playersForClient = players.map((p) => ({
    playerName: p.getName(),
    numbersPlayed: p.numbersPlayed || [],
    gamesPlayed: p.getStats().gamesPlayed,
    gamesWon: p.getStats().gamesWon,
  }));

  wss.clients.forEach((client) => {
    client.send(
      JSON.stringify({
        type: "number_played",
        players: playersForClient,
        currentPhase: state.currentPhase,
        numbersAvailable: result.numbersAvailable,
        numberClicked,
        playerIndex,
      }),
    );
  });

  if (result.currentPhase === "gameOver") {
    for (const [socket, info] of wsToPlayerInfo.entries()) {
      const playerNumber = info.playerNumber;
      const playerIndex = playerNumber - 1;

      const player = players[playerIndex];
      if (!player) continue;

      const stats = player.getStats();

      await db.query(
        `
          INSERT INTO player_stats (client_id, games_played, games_won, last_played)
          VALUES ($1, $2, $3, NOW())
          ON CONFLICT (client_id) DO UPDATE
          SET games_played = EXCLUDED.games_played,
              games_won = EXCLUDED.games_won,
              last_played = NOW()
          `,
        [info.clientId, stats.gamesPlayed, stats.gamesWon],
      );
    }

    wss.clients.forEach((client) => {
      client.send(
        JSON.stringify({
          type: "game_over",
          players: playersForClient,
          winnerIndex: state.winnerIndex,
        }),
      );
    });
  }
}

async function handleUndoPlay(ws, message) {
  const playerInfo = wsToPlayerInfo.get(ws);
  const playerNumber = playerInfo.playerNumber;
  const playerIndex = playerNumber - 1;

  const result = game.undoLastPlay(playerIndex); // assumes your engine method checks playerIndex

  if (!result.success) return;

  const state = game.getState();

  players.forEach((player, idx) => {
    player.numbersPlayed = state.numbersPlayed
      .filter((play) => play.playerIndex === idx)
      .map((play) => play.number);
  });

  const playersForClient = players.map((p) => ({
    playerName: p.getName(),
    numbersPlayed: p.numbersPlayed || [],
    gamesPlayed: p.getStats().gamesPlayed,
    gamesWon: p.getStats().gamesWon,
  }));

  // broadcast updated game state to all clients
  wss.clients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      client.send(
        JSON.stringify({
          type: "undo_played",
          players: playersForClient,
          currentPhase: state.currentPhase,
          numbersAvailable: result.numbersAvailable,
          restoredPlayerIndex: result.restoredPlayerIndex,
          restoredNumber: result.restoredNumber,
        }),
      );
    }
  });
}

async function handleLegacyStats(ws, message) {
  try {
    // Join clients with player_stats for display
    const result = await db.query(`
      SELECT c.alias AS player_name,
             COALESCE(ps.games_played, 0) AS games_played,
             COALESCE(ps.games_won, 0) AS games_won
      FROM clients c
      LEFT JOIN player_stats ps ON c.client_id = ps.client_id
      ORDER BY c.player_number;
    `);

    // send it to the requesting client
    ws.send(
      JSON.stringify({
        type: "legacy_stats",
        players: result.rows,
      }),
    );
  } catch (err) {
    console.error("Error retrieving legacy stats:", err);
    ws.send(
      JSON.stringify({
        type: "legacy_stats",
        error: "Failed to retrieve stats",
      }),
    );
  }
}
