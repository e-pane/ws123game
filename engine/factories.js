import { create123Engine } from "./engine.js";

export function createGame(players) {
  let _engine = create123Engine(players);

  const game = Object.create(null);

  game.getState = () => _engine.getState();
  game.startNewGame = () => _engine.startNewGame();
  game.playNumber = (playerIndex, number) =>
    _engine.playNumber(playerIndex, number);
  game.hasPlayerPlayed = (playerIndex) => _engine.hasPlayerPlayed(playerIndex);
  game.undoLastPlay = (playerIndex) => _engine.undoLastPlay(playerIndex);

  return game;
}

export function createPlayer(name) {
  const player = Object.create(null);

  let _name = name;
  let _gamesPlayed = 0;
  let _gamesWon = 0;

  player.getName = () => _name;
  player.getStats = () => ({ gamesPlayed: _gamesPlayed, gamesWon: _gamesWon });

  player.recordWin = () => {
    _gamesPlayed++;
    _gamesWon++;
  };

  player.recordLoss = () => {
    _gamesPlayed++;
  };

  player.setStats = ({ gamesPlayed, gamesWon }) => {
    _gamesPlayed = gamesPlayed;
    _gamesWon = gamesWon;
  };

  return player;
}
