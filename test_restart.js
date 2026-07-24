const menuActions = document.querySelector('.test').onclick = () => {
  localStorage.setItem('abyss-best', '0');
  localStorage.setItem('abyss-leaderboard', '[]');
  
  // Debug state before death
  console.log('Before gameOverShown:', game.gameOverShown);
  
  // This should trigger the death sequence
  game.die();
  
  // Check if game over screen is shown
  console.log('After die(), gameOverShown:', game.gameOverShown);
  console.log('GameOver element hidden class:', document.getElementById('game-over').classList.contains('hidden'));
  
  // Try to trigger restart through the retry button
  const retryButton = document.getElementById('retry-btn');
  console.log('Retry button exists:', !!retryButton);
  console.log('Retry button hidden?', retryButton.classList.contains('hidden'));
  
  if (retryButton) {
    retryButton.click();
  }
};