const menuActions = document.querySelector('.test').onclick = () => {
  localStorage.setItem('abyss-best', '0');
  localStorage.setItem('abyss-leaderboard', '[]');
  
  console.log('Before gameOverShown:', game.gameOverShown);
  
  // Try die() directly
  if (typeof game.die === 'function') {
    game.die();
    console.log('After die(), gameOverShown:', game.gameOverShown);
    console.log('After die(), alive:', game.alive);
  }
  
  // Try triggering gameOver directly
  console.log('Calling showGameOver()...');
  if (typeof game.showGameOver === 'function') {
    game.showGameOver(10, 0, 50);
  }

  // Try calling showGameOverOnce directly
  console.log('Calling showGameOverOnce(10, 0, 50)...');
  if (typeof game.showGameOverOnce === 'function') {
    game.showGameOverOnce(10, 0, 50);
  }
};