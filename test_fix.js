const game = document.querySelector('.test').onclick = () => {
  localStorage.setItem('abyss-best', '0');
  localStorage.setItem('abyss-leaderboard', '[]');
  
  console.log('Before gameOverShown:', game.gameOverShown);
  game.die();
  console.log('After die(), before timeout - gameOverShown:', game.gameOverShown, 'alive:', game.alive);
  console.log('Game over visible?', !document.getElementById('game-over').classList.contains('hidden'));
};