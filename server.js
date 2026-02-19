import express from "express";
import { WebSocketServer } from "ws";
import http from "http";
import { createGame, createPlayer } from "./engine/factories.js";

import pkg from "pg";
const { Pool } = pkg;

export const db = new Pool({
  user: "epane", 
  host: "localhost",
  database: "my123_game",
  port: 5432,
});

const app = express();
const server = http.createServer(app);

const wss = new WebSocketServer({ server });

app.use(express.static("public"));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export const wsToPlayerInfo = new Map();
let nextPlayerNumber = 1;
let players = [];
let game;
let _winnerIndex = null;
export let loggedInPlayers = 0;


const handlers = {
    start_new_game: handleStartGame,
    click_number: handleClickNumber,
    undo_play: handleUndoPlay,
    get_stats: handleLegacyStats,
}

wss.on("connection", (ws) => {
    console.log("Client connected");

    ws.on("message", async (data) => {
        let message;
        try {
          message = JSON.parse(data);
        } catch {
          return; 
        }
      
        if (message.type === "init") {
          // This is the handshake message containing clientId
          const { clientId, alias } = message;

          // check DB for clientId and insert if needed
          let playerRecord = await db.query(
            "SELECT * FROM clients WHERE client_id = $1",
            [clientId],
          );

          let playerNumber;
          if (playerRecord.rowCount === 0) {
            // new client → insert and return inserted row
            const result = await db.query(
              "INSERT INTO clients (client_id, alias, player_number) VALUES ($1, $2, $3) RETURNING *",
              [
                clientId,
                alias || `Player ${nextPlayerNumber}`,
                nextPlayerNumber,
              ],
            );
            playerNumber = result.rows[0].player_number;
            nextPlayerNumber++; // increment after assignment
          } else {
            playerNumber = playerRecord.rows[0].player_number;
          }

          wsToPlayerInfo.set(ws, { playerNumber, alias, clientId });
          loggedInPlayers++;
          console.log(
            `Assigned Player ${playerNumber} for clientId ${clientId}`,
          );

          return; // done with handshake
        }

        if (handlers[message.type]) {
        await handlers[message.type](ws, message);
        } else {
        console.warn("Unknown message type:", message.type);
        }
    })

    ws.on("close", () => {
        wsToPlayerInfo.delete(ws);
    });
});

async function handleStartGame(ws, message) {
    players = [];

    for (const [, playerInfo] of wsToPlayerInfo) {
        const playerName = `${playerInfo.alias} ${playerInfo.playerNumber}`;
        const player = createPlayer(playerName);
        player.playerName = playerName;
        players.push(player);
    }

    game = createGame(players);

    game.startNewGame();
    
  const state = game.getState();
  
  players.forEach((player, idx) => {
    player.numbersPlayed = state.numbersPlayed
      .filter((play) => play.playerIndex === idx)
      .map((play) => play.number);
  });

    for (const client of wss.clients) {
        if (client.readyState === client.OPEN) {
            client.send(
              JSON.stringify({
                type: "ready_to_start",
                players,
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

    wss.clients.forEach((client) => {
      client.send(
        JSON.stringify({
          type: "number_played",
          players,
          currentPhase: state.currentPhase,
          numbersAvailable: result.numbersAvailable,
          numberClicked,
          playerIndex,
        }),
      );
    });
      
  if (result.currentPhase === "gameOver") {
      players.forEach((player, idx) => {
        if (idx === _winnerIndex) {
          player.recordWin();
        } else {
          player.recordLoss();
        }
      });
    
      for (const player of players) {
        const { clientId } = wsToPlayerInfo.get(ws); // or store in player object
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
          [clientId, stats.gamesPlayed, stats.gamesWon],
        );
      }
    
      wss.clients.forEach((client) => {
          client.send(
            JSON.stringify({
              type: "game_over",
              players,
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

  // broadcast updated game state to all clients
  wss.clients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      client.send(
        JSON.stringify({
          type: "undo_played",
          players,
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
