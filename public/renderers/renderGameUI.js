import { ws } from "../index.js";

const numberToImage = {
  1: "/images/ball1.png",
  2: "/images/ball2.png",
  3: "/images/ball3.png",
  4: "/images/ball4.png",
  5: "/images/ball5.png",
  // 6: "/images/6.png",
  // 7: "/images/7.png",
  // 8: "/images/8.png",
};

export function renderStartButton() {
  const container = document.querySelector("#gameView");

  if (!container) {
    console.error("[renderStartButton] #gameView not found");
    return;
  }

  const oldWrapper = container.querySelector("#start-btn-wrapper");
  if (oldWrapper) oldWrapper.remove();

  // create wrapper
  const wrapper = document.createElement("div");
  wrapper.id = "start-btn-wrapper";
  wrapper.classList.add("start-btn-wrapper"); 

  // create button
  const button = document.createElement("button");
  button.id = "start-btn";
  button.textContent = "Start New Game";
  button.classList.add("start-button"); 

  button.addEventListener("click", () => {
    const msg = { type: "start_new_game" };
    ws.send(JSON.stringify(msg));
  });

  wrapper.appendChild(button);
  container.appendChild(wrapper);
}

export function clearStartButton() {
  const wrapper = document.querySelector("#start-btn-wrapper");
  if (wrapper) {
    wrapper.remove();
  }
}

export function clearPreGameUI() {
  const divs = document.querySelectorAll(
    ".number1, .number2, .number3, .stopwatch, .trophy",
  );
  divs.forEach((div) => {
    div.style.backgroundImage = "none";
  });
}

export function renderGameUI({ players, currentPhase, numbersAvailable }) {
  // Render the balls in the main play area
  renderPlayArea(numbersAvailable, currentPhase);

  // Render the balls already played for each player
  players.forEach((p, idx) => {
    renderPlayerBalls(idx, p.numbersPlayed || []);
  });

  // Update player names, etc.
  players.forEach((p, idx) => {
    const container = document.querySelector(`#player-${idx}`);
    if (!container) return;
    const nameSpan = container.querySelector(".player-name");
    if (nameSpan) nameSpan.textContent = p.playerName;
  });
}

export function renderPlayArea(numbersAvailable, currentPhase) {
  const numberRow = document.querySelector(".number-row");
  if (!numberRow) return;

  numberRow.innerHTML = ""; // clear previous balls

  numbersAvailable.forEach((num) => {
    const ball = document.createElement("img");
    ball.src = numberToImage[num];
    ball.classList.add("game-billiard-ball");
    ball.dataset.number = num;

    const rowRect = numberRow.getBoundingClientRect();
    const ballSize = 200;
    const padding = 20;
    const maxX = rowRect.width - ballSize - padding;
    const maxY = rowRect.height - ballSize - padding;
    ball.style.left = `${Math.random() * maxX + padding}px`;
    ball.style.top = `${Math.random() * maxY + padding}px`;

    ball.addEventListener("click", () => {
      if (currentPhase !== "gamePlay") return;
      ws.send(JSON.stringify({ type: "click_number", number: num }));
    });

    numberRow.appendChild(ball);
  });
}

export function renderPlayerBalls(playerIndex, numbersPlayedByPlayer) {
  const container = document.querySelector(`#player-${playerIndex}`);
  if (!container) return;

  const oldBalls = container.querySelectorAll(".played-billiard-ball");
  oldBalls.forEach((ball) => ball.remove());

  numbersPlayedByPlayer.forEach((num) => {
    const ball = document.createElement("img");
    ball.src = numberToImage[num];
    ball.classList.add("played-billiard-ball");
    ball.dataset.number = num;

    ball.addEventListener("click", () => {
      ws.send(
        JSON.stringify({
          type: "undo_play",
          playerIndex,
          number: num,
        }),
      );
    });

    container.appendChild(ball);
  });
}

export function renderGameOver(winnerName) {
  const numberRow = document.querySelector(".number-row");
  if (!numberRow) return;

  document
    .querySelectorAll(".winner-message, .trophy-overlay, .legacy-message")
    .forEach((el) => el.remove());

  // --- Winner overlay ---
  const winnerOverlay = document.createElement("div");
  winnerOverlay.classList.add("winner-message");
  winnerOverlay.textContent = `${winnerName} WINS!!!!`;

  // --- Trophy + Legacy overlay container ---
  const trophyContainer = document.createElement("div");
  trophyContainer.classList.add("trophy-overlay");

  // Trophy image
  const trophyImage = document.createElement("img");
  trophyImage.src = "/images/trophy.png";
  trophyContainer.appendChild(trophyImage);

  // Legacy stats text
  const legacyOverlay = document.createElement("div");
  legacyOverlay.classList.add("legacy-message");
  legacyOverlay.textContent = "Legacy Stats";
  trophyContainer.appendChild(legacyOverlay);

  legacyOverlay.addEventListener("click", () => {
    ws.send(JSON.stringify({ type: "get_stats" }));
  });

  // Append to the main number row
  numberRow.appendChild(winnerOverlay);
  numberRow.appendChild(trophyContainer);
}

export function renderLegacyStats(players) {
  // Remove any existing overlay
  const existing = document.querySelector(".legacy-stats-overlay");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.classList.add("legacy-stats-overlay");

  // Table with dynamic rows
  const table = document.createElement("table");
  table.innerHTML = `
    <thead>
      <tr>
        <th>Player</th>
        <th>Games Played</th>
        <th>Games Won</th>
      </tr>
    </thead>
    <tbody>
      ${players
        .map(
          (p) => `
        <tr>
          <td>${p.player_name}</td>
          <td>${p.games_played}</td>
          <td>${p.games_won}</td>
        </tr>
      `,
        )
        .join("")}
    </tbody>
  `;
  overlay.appendChild(table);

  // Close button
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "Close";
  closeBtn.classList.add("close-legacy-btn");
  closeBtn.onclick = () => overlay.remove();
  overlay.appendChild(closeBtn);

  document.body.appendChild(overlay);
}

