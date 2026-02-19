import { wsToPlayerInfo, loggedInPlayers } from "../server.js"

export function create123Engine(players) {
  let _players = players;
  let _currentPhase = "gamePlay" // waiting | gamePlay | gameOver
  let _loggedInPlayers = loggedInPlayers;
  let _numbersAvailable = [];
  for (let i = 0; i < _loggedInPlayers; i++) {
    _numbersAvailable.push(i + 1);
  }
  let _numbersPlayed = [];
  let _score = 0;
  let _winnerIndex = null;
  
  const engine = Object.create(null);

  engine.getState = () => ({
    currentPhase: _currentPhase,
    currentNumber: _numbersAvailable[0] ?? null,
    numbersAvailable: _numbersAvailable,
    numbersPlayed: _numbersPlayed,
    score: _score,
    players: _players,
    winnerIndex: _winnerIndex,
    loggedInPlayers: _loggedInPlayers,
  });

  engine.startNewGame = () => {
    _currentPhase = "gamePlay";
    return {
      currentPhase: _currentPhase,
    };
  };

  engine.canPlayNumber = (number) => {
    if (_numbersAvailable.length === 0) return false;

    const nextNumber = _numbersAvailable[0]; // must click 1 first, then 2, then 3
    return number === nextNumber;
  };

  engine.playNumber = (playerIndex, number) => {
    if (_currentPhase !== "gamePlay") {
      return { success: false, error: "Not in gameplay phase" };
    }
    if (!engine.canPlayNumber(number)) {
      return {
        success: false,
        error: `Must play ${_numbersAvailable[0]} next`,
      };
    }

    if (engine.hasPlayerPlayed(playerIndex)) {
      return { success: false, error: "Player already played" };
    }

    // remove number from available
    _numbersAvailable.shift();

    // record play for undo
    _numbersPlayed.push({ playerIndex, number });

    if (_numbersAvailable.length === 0) {
      _currentPhase = "gameOver";

      const winningNumber = Math.floor(Math.random() * loggedInPlayers) + 1;

      const playedWinningNumber = _numbersPlayed.find(
        (p) => p.number === winningNumber,
      );
      if (playedWinningNumber) _winnerIndex = playedWinningNumber.playerIndex;

      _players.forEach((p, idx) => {
        if (idx === _winnerIndex) p.recordWin();
        else p.recordLoss();
      });
    }

    return {
      success: true,
      currentPhase: _currentPhase,
      numbersAvailable: [..._numbersAvailable],
      numbersPlayed: [..._numbersPlayed],
      ...(_winnerIndex !== null ? { _winnerIndex } : {}),
    };
  };

  engine.hasPlayerPlayed = (playerIndex) =>
    _numbersPlayed.some((p) => p.playerIndex === playerIndex);

  engine.undoLastPlay = (requestingPlayerIndex) => {
    if (_currentPhase !== "gamePlay") {
      return { success: false, error: "Not in gameplay phase" };
    }

    if (_numbersPlayed.length === 0) {
      return { success: false, error: "Nothing to undo" };
    }
    const last = _numbersPlayed[_numbersPlayed.length - 1];

    if (last.playerIndex !== requestingPlayerIndex) {
      return { success: false, error: "Cannot undo another player's move" };
    }

    _numbersPlayed.pop();
    _numbersAvailable.unshift(last.number);

    return {
      success: true,
      numbersAvailable: [..._numbersAvailable],
      numbersPlayed: [..._numbersPlayed],
      restoredPlayerIndex: last.playerIndex,
      restoredNumber: last.number,
    };
  };

  return engine;
}
