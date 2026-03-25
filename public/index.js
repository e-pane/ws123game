import {
    renderGameUI,
    renderStartButton,
    clearStartButton,
    clearPreGameUI,
    renderGameOver,
    renderLegacyStats,
} from "./renderers/renderGameUI.js";

function generateUUID() {
  // simple RFC4122 version 4 compliant UUID
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

let clientId = localStorage.getItem("clientId");
if (!clientId) {
  clientId = generateUUID(); // fallback UUID
  localStorage.setItem("clientId", clientId);
}

export const ws = new WebSocket("ws://10.0.0.98:3000");

ws.onopen = () => {
  ws.send(
    JSON.stringify({
      type: "init",
      clientId,
    }),
  );
};

const clientHandlers = {
  ready_to_start: handleGameStart,
  number_played: handlePlayNumber,
  undo_played: handleUndoPlay,
  game_over: handleGameOver,
  legacy_stats: handleLegacyStatsOverlay,
};

ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    const handler = clientHandlers[message.type];
    if (handler) {
        handler(message);
    } else {
        console.warn("No client handler for message type:", message.type);
    }
}

function handleGameStart(message) {
    clearStartButton();
    clearPreGameUI()
    renderGameUI(message, ws);
}

function handlePlayNumber(message) {
    const { players, currentPhase, numbersAvailable } = message;
    renderGameUI({ players, currentPhase, numbersAvailable }, ws);
    }

function handleUndoPlay(message) {
    console.log("client side undo play handler reached");
    const { players, currentPhase, numbersAvailable } = message;
    
    // players.forEach((player, idx) => {
    //   player.playerName = players[idx].playerName;
    //   player.numbersPlayed = players[idx].numbersPlayed;
    //   player.gamesPlayed = players[idx].gamesPlayed;
    //   player.gamesWon = players[idx].gamesWon;
    // });
    renderGameUI({ players, currentPhase, numbersAvailable }, ws);
}

function handleGameOver(message) {
    const players = message.players;
    const winnerIndex = message.winnerIndex
    console.log(winnerIndex);
    const winningPlayer = players[winnerIndex];
    console.log(winningPlayer);
    const winningPlayerName = winningPlayer.playerName;
  
    renderGameOver(winningPlayerName, ws);
    renderStartButton(ws);
}

function handleLegacyStatsOverlay(message) {
    const { players, error } = message;
    if (error) return alert(error);
    
    renderLegacyStats(players);
}

renderStartButton(ws);
