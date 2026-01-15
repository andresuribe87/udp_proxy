import { test, expect, Page } from '@playwright/test';

/**
 * E2E tests for video click and camera mode controls
 * 
 * Note: These tests require:
 * 1. The Rust backend server running on port 8081
 * 2. The frontend server running on port 8889 (or update baseURL in playwright.config.ts)
 * 3. A mock UDP source (or actual drone connection) for the backend to have a source address
 */

// Helper to wait for video element to be ready
async function waitForVideo(page: Page) {
  await page.waitForSelector('#video', { timeout: 10000 });
  // Wait a bit for video to potentially load
  await page.waitForTimeout(500);
}

// Helper to mock backend responses
async function setupBackendMocks(page: Page) {
  // Mock WHEP endpoint (WebRTC) to prevent connection errors
  await page.route('**/whep*', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({
        status: 200,
        headers: { 'Link': '<stun:stun.l.google.com:19302>; rel="ice-server"' }
      });
    } else {
      await route.fulfill({
        status: 201,
        headers: { 'Location': 'http://localhost:8889/whep/session123' },
        body: 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n'
      });
    }
  });

  // Intercept video-click requests
  await page.route('**/video-click', async (route) => {
    const request = route.request();
    const postData = request.postDataJSON();
    
    // Calculate expected transformed coordinates
    const xPos = (postData.click_x * 1280) / postData.window_width;
    const yPos = (postData.click_y * 720) / postData.window_height;
    
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'success',
        message: 'Tracking command(s) sent',
        target: '127.0.0.1:12345',
        x_pos: xPos,
        y_pos: yPos,
        channel_id: postData.channel_id,
        command_type: postData.command_type,
        sequences: [1]
      })
    });
  });

  // Intercept set-camera-mode requests
  await page.route('**/set-camera-mode', async (route) => {
    const request = route.request();
    const postData = request.postDataJSON();
    
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'success',
        message: `Camera mode changed to: ${postData.mode}`,
        target: '127.0.0.1:12345',
        mode: postData.mode,
        sequence: 1
      })
    });
  });
}

test.describe('Video Click Controls', () => {
  test.beforeEach(async ({ page }) => {
    // Set up backend mocks first (before navigation)
    await setupBackendMocks(page);
    
    // Navigate to the video page
    await page.goto('/webrtc/index.html');
    await waitForVideo(page);
  });

  test('should display video element', async ({ page }) => {
    const video = page.locator('#video');
    await expect(video).toBeVisible();
    
    // Take screenshot for visual verification
    const screenshot = await page.screenshot({ 
      path: 'test-results/screenshots/01-video-element-visible.png',
      fullPage: true 
    });
    await test.info().attach('01-video-element-visible.png', {
      body: screenshot,
      contentType: 'image/png',
    });
  });

  test('should display camera mode buttons', async ({ page }) => {
    const trackingOffBtn = page.locator('#tracking-off-btn');
    const trackingOnBtn = page.locator('#tracking-on-btn');

    await expect(trackingOffBtn).toBeVisible();
    await expect(trackingOnBtn).toBeVisible();
    await expect(trackingOffBtn).toHaveText('Tracking Off');
    await expect(trackingOnBtn).toHaveText('Tracking On');
    
    // Take screenshot showing buttons
    const screenshot = await page.screenshot({ 
      path: 'test-results/screenshots/02-camera-mode-buttons-visible.png',
      fullPage: true 
    });
    await test.info().attach('02-camera-mode-buttons-visible.png', {
      body: screenshot,
      contentType: 'image/png',
    });
  });

  test('should show click marker when clicking on video', async ({ page }) => {
    const video = page.locator('#video');
    
    // Get video dimensions
    const videoBox = await video.boundingBox();
    if (!videoBox) {
      throw new Error('Video element not found');
    }

    // Take screenshot before click
    const screenshot1 = await page.screenshot({ 
      path: 'test-results/screenshots/03-before-click.png',
      fullPage: true 
    });
    await test.info().attach('03-before-click.png', {
      body: screenshot1,
      contentType: 'image/png',
    });

    // Click in the center of the video
    const clickX = videoBox.x + videoBox.width / 2;
    const clickY = videoBox.y + videoBox.height / 2;
    
    await page.mouse.click(clickX, clickY);

    // Check for click marker (it should appear briefly)
    const marker = page.locator('.click-marker');
    await expect(marker).toBeVisible({ timeout: 100 });
    
    // Take screenshot showing the click marker
    const screenshot2 = await page.screenshot({ 
      path: 'test-results/screenshots/04-click-marker-visible.png',
      fullPage: true 
    });
    await test.info().attach('04-click-marker-visible.png', {
      body: screenshot2,
      contentType: 'image/png',
    });
    
    // Marker should disappear after animation
    await page.waitForTimeout(600);
    await expect(marker).not.toBeVisible();
    
    // Take screenshot after marker disappears
    const screenshot3 = await page.screenshot({ 
      path: 'test-results/screenshots/05-after-marker-disappears.png',
      fullPage: true 
    });
    await test.info().attach('05-after-marker-disappears.png', {
      body: screenshot3,
      contentType: 'image/png',
    });
  });

  test('should send video click request to backend', async ({ page }) => {
    const video = page.locator('#video');
    
    // Set up request interception to verify the request
    let requestData: any = null;
    page.on('request', (request) => {
      if (request.url().includes('/video-click')) {
        requestData = request.postDataJSON();
      }
    });

    const videoBox = await video.boundingBox();
    if (!videoBox) {
      throw new Error('Video element not found');
    }

    // Take screenshot before click
    const screenshotBefore = await page.screenshot({ 
      path: 'test-results/screenshots/10-before-video-click-request.png',
      fullPage: true 
    });
    await test.info().attach('10-before-video-click-request.png', {
      body: screenshotBefore,
      contentType: 'image/png',
    });

    const clickX = videoBox.x + videoBox.width / 2;
    const clickY = videoBox.y + videoBox.height / 2;
    
    await page.mouse.click(clickX, clickY);

    // Wait for request to be made
    await page.waitForTimeout(100);

    expect(requestData).not.toBeNull();
    expect(requestData.command_type).toBe('Tracking');
    expect(requestData.channel_id).toBe(0);
    expect(typeof requestData.window_width).toBe('number');
    expect(typeof requestData.window_height).toBe('number');
    expect(typeof requestData.click_x).toBe('number');
    expect(typeof requestData.click_y).toBe('number');

    // Take screenshot after click
    const screenshotAfter = await page.screenshot({ 
      path: 'test-results/screenshots/11-after-video-click-request.png',
      fullPage: true 
    });
    await test.info().attach('11-after-video-click-request.png', {
      body: screenshotAfter,
      contentType: 'image/png',
    });
  });

  test('should handle multiple clicks', async ({ page }) => {
    const video = page.locator('#video');
    const videoBox = await video.boundingBox();
    
    if (!videoBox) {
      throw new Error('Video element not found');
    }

    // Take screenshot before multiple clicks
    const screenshotBefore = await page.screenshot({ 
      path: 'test-results/screenshots/12-before-multiple-clicks.png',
      fullPage: true 
    });
    await test.info().attach('12-before-multiple-clicks.png', {
      body: screenshotBefore,
      contentType: 'image/png',
    });

    // Click multiple times
    for (let i = 0; i < 3; i++) {
      const clickX = videoBox.x + (videoBox.width * (i + 1) / 4);
      const clickY = videoBox.y + videoBox.height / 2;
      await page.mouse.click(clickX, clickY);
      await page.waitForTimeout(200);
    }

    // Wait for all markers to disappear
    await page.waitForTimeout(600);

    // Take screenshot after multiple clicks
    const screenshotAfter = await page.screenshot({ 
      path: 'test-results/screenshots/13-after-multiple-clicks.png',
      fullPage: true 
    });
    await test.info().attach('13-after-multiple-clicks.png', {
      body: screenshotAfter,
      contentType: 'image/png',
    });

    // All clicks should have been processed
    // (In a real scenario, we'd verify the backend received all requests)
  });
});

test.describe('Camera Mode Controls', () => {
  test.beforeEach(async ({ page }) => {
    await setupBackendMocks(page);
    await page.goto('/webrtc/index.html');
    await waitForVideo(page);
  });

  test('should toggle to tracking on mode', async ({ page }) => {
    const trackingOnBtn = page.locator('#tracking-on-btn');
    const trackingOffBtn = page.locator('#tracking-off-btn');

    // Initially, tracking off should be active (Radix UI Toggle Group pattern)
    await expect(trackingOffBtn).toHaveAttribute('data-state', 'on');
    await expect(trackingOffBtn).toHaveAttribute('aria-pressed', 'true');
    
    // Take screenshot showing initial state (Tracking Off active) - before interaction
    const screenshotBefore = await page.screenshot({ 
      path: 'test-results/screenshots/06-before-toggle-to-tracking-on.png',
      fullPage: true 
    });
    await test.info().attach('06-before-toggle-to-tracking-on.png', {
      body: screenshotBefore,
      contentType: 'image/png',
    });

    // Click tracking on button
    let requestData: any = null;
    page.on('request', (request) => {
      if (request.url().includes('/set-camera-mode')) {
        requestData = request.postDataJSON();
      }
    });

    await trackingOnBtn.click();
    await page.waitForTimeout(100);

    // Verify request was sent
    expect(requestData).not.toBeNull();
    expect(requestData.mode).toBe(7);

    // Verify button state changed (Radix UI Toggle Group pattern)
    await expect(trackingOnBtn).toHaveAttribute('data-state', 'on');
    await expect(trackingOnBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(trackingOffBtn).toHaveAttribute('data-state', 'off');
    await expect(trackingOffBtn).toHaveAttribute('aria-pressed', 'false');
    
    // Take screenshot showing Tracking On is now active - after interaction
    const screenshotAfter = await page.screenshot({ 
      path: 'test-results/screenshots/07-after-toggle-to-tracking-on.png',
      fullPage: true 
    });
    await test.info().attach('07-after-toggle-to-tracking-on.png', {
      body: screenshotAfter,
      contentType: 'image/png',
    });
  });

  test('should toggle to tracking off mode', async ({ page }) => {
    const trackingOnBtn = page.locator('#tracking-on-btn');
    const trackingOffBtn = page.locator('#tracking-off-btn');

    // First set to tracking on
    await trackingOnBtn.click();
    await page.waitForTimeout(100);
    
    // Take screenshot showing Tracking On active
    const screenshot1 = await page.screenshot({ 
      path: 'test-results/screenshots/08-before-toggle-to-off.png',
      fullPage: true 
    });
    await test.info().attach('08-before-toggle-to-off.png', {
      body: screenshot1,
      contentType: 'image/png',
    });

    // Then click tracking off
    let requestData: any = null;
    page.on('request', (request) => {
      if (request.url().includes('/set-camera-mode')) {
        requestData = request.postDataJSON();
      }
    });

    await trackingOffBtn.click();
    await page.waitForTimeout(100);

    // Verify request was sent with mode 0
    expect(requestData).not.toBeNull();
    expect(requestData.mode).toBe(0);

    // Verify button state changed (Radix UI Toggle Group pattern)
    await expect(trackingOffBtn).toHaveAttribute('data-state', 'on');
    await expect(trackingOffBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(trackingOnBtn).toHaveAttribute('data-state', 'off');
    await expect(trackingOnBtn).toHaveAttribute('aria-pressed', 'false');
    
    // Take screenshot showing Tracking Off is now active again
    const screenshot2 = await page.screenshot({ 
      path: 'test-results/screenshots/09-tracking-off-active-again.png',
      fullPage: true 
    });
    await test.info().attach('09-tracking-off-active-again.png', {
      body: screenshot2,
      contentType: 'image/png',
    });
  });

  test('should not send request when clicking already active button', async ({ page }) => {
    const trackingOffBtn = page.locator('#tracking-off-btn');
    
    // Tracking off should be active by default (Radix UI Toggle Group pattern)
    await expect(trackingOffBtn).toHaveAttribute('data-state', 'on');
    await expect(trackingOffBtn).toHaveAttribute('aria-pressed', 'true');

    // Take screenshot before clicking already active button
    const screenshotBefore = await page.screenshot({ 
      path: 'test-results/screenshots/14-before-click-active-button.png',
      fullPage: true 
    });
    await test.info().attach('14-before-click-active-button.png', {
      body: screenshotBefore,
      contentType: 'image/png',
    });

    let requestCount = 0;
    page.on('request', (request) => {
      if (request.url().includes('/set-camera-mode')) {
        requestCount++;
      }
    });

    // Click the already active button
    await trackingOffBtn.click();
    await page.waitForTimeout(100);

    // Should not send a request since it's already active
    // In our implementation, it checks currentMode and doesn't send if already 0
    expect(requestCount).toBe(0);

    // Take screenshot after clicking (state should remain unchanged)
    const screenshotAfter = await page.screenshot({ 
      path: 'test-results/screenshots/15-after-click-active-button.png',
      fullPage: true 
    });
    await test.info().attach('15-after-click-active-button.png', {
      body: screenshotAfter,
      contentType: 'image/png',
    });
  });
});

test.describe('Integration: Click and Mode Together', () => {
  test.beforeEach(async ({ page }) => {
    await setupBackendMocks(page);
    await page.goto('/webrtc/index.html');
    await waitForVideo(page);
  });

  test('should handle video click after mode change', async ({ page }) => {
    const trackingOnBtn = page.locator('#tracking-on-btn');
    const video = page.locator('#video');

    // Take screenshot before mode change
    const screenshotBeforeMode = await page.screenshot({ 
      path: 'test-results/screenshots/16-before-mode-change.png',
      fullPage: true 
    });
    await test.info().attach('16-before-mode-change.png', {
      body: screenshotBeforeMode,
      contentType: 'image/png',
    });

    // Change mode first
    await trackingOnBtn.click();
    await page.waitForTimeout(100);

    // Take screenshot after mode change, before video click
    const screenshotAfterMode = await page.screenshot({ 
      path: 'test-results/screenshots/17-after-mode-change-before-click.png',
      fullPage: true 
    });
    await test.info().attach('17-after-mode-change-before-click.png', {
      body: screenshotAfterMode,
      contentType: 'image/png',
    });

    // Then click on video
    const videoBox = await video.boundingBox();
    if (!videoBox) {
      throw new Error('Video element not found');
    }

    const clickX = videoBox.x + videoBox.width / 2;
    const clickY = videoBox.y + videoBox.height / 2;
    
    await page.mouse.click(clickX, clickY);
    await page.waitForTimeout(100);

    // Both actions should have completed
    await expect(trackingOnBtn).toHaveAttribute('data-state', 'on');
    await expect(trackingOnBtn).toHaveAttribute('aria-pressed', 'true');

    // Take screenshot after video click
    const screenshotAfterClick = await page.screenshot({ 
      path: 'test-results/screenshots/18-after-video-click-after-mode-change.png',
      fullPage: true 
    });
    await test.info().attach('18-after-video-click-after-mode-change.png', {
      body: screenshotAfterClick,
      contentType: 'image/png',
    });
  });
});

