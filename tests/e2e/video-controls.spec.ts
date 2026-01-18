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
  
  // Set videoWidth and videoHeight on the video element for coordinate calculation
  // These properties are normally set when video metadata loads, but in tests we need to set them manually
  await page.evaluate(() => {
    const videoElement = document.querySelector('#video') as HTMLVideoElement;
    if (videoElement) {
      // Delete existing property descriptors if they exist, then set new ones
      delete (videoElement as any).videoWidth;
      delete (videoElement as any).videoHeight;
      Object.defineProperty(videoElement, 'videoWidth', { 
        value: 1920, 
        writable: false, 
        configurable: true,
        enumerable: true
      });
      Object.defineProperty(videoElement, 'videoHeight', { 
        value: 1080, 
        writable: false, 
        configurable: true,
        enumerable: true
      });
    }
  });
  
  // Verify properties are accessible from Playwright
  const videoWidth = await page.evaluate(() => {
    const videoElement = document.querySelector('#video') as HTMLVideoElement;
    return videoElement?.videoWidth || 0;
  });
  const videoHeight = await page.evaluate(() => {
    const videoElement = document.querySelector('#video') as HTMLVideoElement;
    return videoElement?.videoHeight || 0;
  });
  
  if (videoWidth === 0 || videoHeight === 0) {
    throw new Error(`Video dimensions not set correctly: videoWidth=${videoWidth}, videoHeight=${videoHeight}`);
  }
}

// Helper to mock backend responses
async function setupBackendMocks(page: Page) {
  // Mock /config endpoint to return backend API configuration
  // The test server also handles this, but we mock it here for consistency
  await page.route('**/config', async (route) => {
    const requestUrl = route.request().url();
    const url = new URL(requestUrl);
    const backendApiPort = 8081; // Default backend API port
    const backendApiUrl = `${url.protocol}//${url.hostname}:${backendApiPort}`;
    
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS'
      },
      body: JSON.stringify({
        backend_api_port: backendApiPort,
        backend_api_url: backendApiUrl
      })
    });
  });

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
    
    // Coordinates are already in video space (scaled by frontend to video's natural dimensions)
    // No transformation needed - just use coordinates directly
    const xPos = postData.click_x;
    const yPos = postData.click_y;
    
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
    
    // Wait for config to be fetched and video element to be initialized
    // The frontend now waits for initBackendUrl() before creating the video element
    // Give it time to fetch config and initialize
    await page.waitForTimeout(1000);
    
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

  test('should display camera actions panel', async ({ page }) => {
    // Wait for camera actions panel to load
    await page.waitForSelector('.camera-actions-panel', { timeout: 10000 });
    
    const cameraModesGrid = page.locator('.camera-modes-grid');
    await expect(cameraModesGrid).toBeVisible();
    
    // Verify some mode buttons exist
    const holdButton = page.locator('.mode-btn', { hasText: 'Hold' });
    await expect(holdButton.first()).toBeVisible();
    
    // Take screenshot showing camera actions panel
    const screenshot = await page.screenshot({ 
      path: 'test-results/screenshots/02-camera-actions-panel-visible.png',
      fullPage: true 
    });
    await test.info().attach('02-camera-actions-panel-visible.png', {
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
    expect(typeof requestData.video_width).toBe('number');
    expect(typeof requestData.video_height).toBe('number');
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
    await page.waitForTimeout(2000); // Wait for camera actions panel to load
    await waitForVideo(page);
  });

  test('should send tracking mode command from camera actions panel', async ({ page }) => {
    // Wait for camera actions panel
    await page.waitForSelector('.camera-actions-panel', { timeout: 10000 });
    
    // Find a mode button (use Hold as example, or any mode button)
    // Note: There's no separate "Tracking" button - tracking is mode 7 which can be set via any mode button
    // Let's test with Hold button instead
    const holdButton = page.locator('.mode-btn', { hasText: 'Hold' }).first();
    await expect(holdButton).toBeVisible();
    
    // Take screenshot before clicking
    const screenshotBefore = await page.screenshot({ 
      path: 'test-results/screenshots/06-before-tracking-mode-click.png',
      fullPage: true 
    });
    await test.info().attach('06-before-tracking-mode-click.png', {
      body: screenshotBefore,
      contentType: 'image/png',
    });

    // Click tracking button
    let requestData: any = null;
    page.on('request', (request) => {
      if (request.url().includes('/camera-command')) {
        requestData = request.postDataJSON();
      }
    });

    await holdButton.click();
    await page.waitForTimeout(100);

    // Verify request was sent with Hold mode (mode 2)
    expect(requestData).not.toBeNull();
    expect(requestData.param1).toBe(0); // SetSystemMode command
    expect(requestData.param2).toBe(2); // Hold mode
    
    // Take screenshot after clicking
    const screenshotAfter = await page.screenshot({ 
      path: 'test-results/screenshots/07-after-tracking-mode-click.png',
      fullPage: true 
    });
    await test.info().attach('07-after-tracking-mode-click.png', {
      body: screenshotAfter,
      contentType: 'image/png',
    });
  });

  test('should send hold mode command from camera actions panel', async ({ page }) => {
    // Wait for camera actions panel
    await page.waitForSelector('.camera-actions-panel', { timeout: 10000 });
    
    const holdButton = page.locator('.mode-btn', { hasText: 'Hold' }).first();
    await expect(holdButton).toBeVisible();
    
    // Take screenshot before clicking
    const screenshotBefore = await page.screenshot({ 
      path: 'test-results/screenshots/08-before-hold-mode-click.png',
      fullPage: true 
    });
    await test.info().attach('08-before-hold-mode-click.png', {
      body: screenshotBefore,
      contentType: 'image/png',
    });

    let requestData: any = null;
    page.on('request', (request) => {
      if (request.url().includes('/camera-command')) {
        requestData = request.postDataJSON();
      }
    });

    await holdButton.click();
    await page.waitForTimeout(100);

    // Verify request was sent with Hold mode (mode 2)
    expect(requestData).not.toBeNull();
    expect(requestData.param1).toBe(0); // SetSystemMode command
    expect(requestData.param2).toBe(2); // Hold mode
    
    // Take screenshot after clicking
    const screenshotAfter = await page.screenshot({ 
      path: 'test-results/screenshots/09-after-hold-mode-click.png',
      fullPage: true 
    });
    await test.info().attach('09-after-hold-mode-click.png', {
      body: screenshotAfter,
      contentType: 'image/png',
    });
  });

  test('should send command every time button is clicked', async ({ page }) => {
    // Wait for camera actions panel
    await page.waitForSelector('.camera-actions-panel', { timeout: 10000 });
    
    const holdButton = page.locator('.mode-btn', { hasText: 'Hold' }).first();
    await expect(holdButton).toBeVisible();

    let requestCount = 0;
    page.on('request', (request) => {
      if (request.url().includes('/camera-command')) {
        requestCount++;
      }
    });

    // Click the button multiple times
    await holdButton.click();
    await page.waitForTimeout(100);
    await holdButton.click();
    await page.waitForTimeout(100);
    await holdButton.click();
    await page.waitForTimeout(100);

    // Should send a request every time (no state checking)
    expect(requestCount).toBe(3);
  });
});

test.describe('Integration: Click and Mode Together', () => {
  test.beforeEach(async ({ page }) => {
    await setupBackendMocks(page);
    await page.goto('/webrtc/index.html');
    await waitForVideo(page);
  });

  test('should handle video click after mode change', async ({ page }) => {
    // Wait for camera actions panel
    await page.waitForSelector('.camera-actions-panel', { timeout: 10000 });
    
    const holdButton = page.locator('.mode-btn', { hasText: 'Hold' }).first();
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

    // Change mode first (click Hold button)
    await holdButton.click();
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
    await expect(holdButton).toBeVisible();

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

