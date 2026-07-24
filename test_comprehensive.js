const menuActions = document.querySelector('.test').onclick = () => {
  // First, clear existing leaderboards and best scores
  localStorage.setItem('abyss-best', '0');
  localStorage.setItem('abyss-leaderboard', '[]');
  
  console.log('=== Testing Game Over After Death ===');
  
  // Check initial state
  console.log('1. Initial state:');
  console.log('   - gameOverShown:', game.gameOverShown);
  console.log('   - alive:', game.alive);
  console.log('   - aliveInitial:', game.alive);
  
  // We'll simulate death by directly calling the death sequence manually
  console.log('\n2. Simulating death sequence...');
  
  // Manually trigger death
  game.isTransitioning = true;
  game.alive = false;
  game.paused = false;
  game.audio.stopDrone();
  game.ui.hidePause();
  game.ui.flash('death');
  
  console.log('   - After manual die setup:');
  console.log('     - gameOverShown:', game.gameOverShown);
  console.log('     - alive:', game.alive);
  console.log('     - isTransitioning:', game.isTransitioning);
  
  // Check game-over state immediately
  console.log('\n3. Checking game-over state...');
  const gameOverEl = document.getElementById('game-over');
  console.log('   - GameOver element:', gameOverEl);
  console.log('   - GameOver has hidden class:', gameOverEl?.classList.contains('hidden'));
  console.log('   - GameOver aria-hidden:', gameOverEl?.getAttribute('aria-hidden'));
  
  // Show game over manually
  console.log('\n4. Manually calling showGameOverOnce...');
  game.showGameOverOnce(100, 0, 50);
  
  // Check if it worked
  console.log('\n5. After showGameOverOnce:');
  console.log('   - gameOverShown:', game.gameOverShown);
  console.log('   - alive:', game.alive);
  console.log('   - isTransitioning:', game.isTransitioning);
  
  // Check game-over visual state
  console.log('\n6. Checking if game-over is visible...');
  console.log('   - GameOver has hidden class:', gameOverEl?.classList.contains('hidden'));
  console.log('   - GameOver aria-hidden:', gameOverEl?.getAttribute('aria-hidden'));
  
  // Try to trigger restart
  console.log('\n7. Testing restart functionality...');
  const retryButton = document.getElementById('retry-btn');
  console.log('   - Retry button found:', !!retryButton);
  console.log('   - Retry button text:', retryButton?.textContent || 'N/A');
  console.log('   - Retry button has hidden class:', retryButton?.classList.contains('hidden'));
  
  if (retryButton) {
    retryButton.click();
    console.log('   - Clicked retry button');
  }
  
  // Give some time for restart
  setTimeout(() => {
    console.log('\n8. After restart delay:');
    console.log('   - alive:', game.alive);
    console.log('   - HUD visible:', !document.getElementById('hud').classList.contains('hidden'));
  }, 100);
};