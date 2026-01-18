import { test, expect, Page } from '@playwright/test';

/**
 * E2E screenshot tests for camera actions UI
 * Tests the camera modes grid, gimbal controls, zoom, and focus buttons
 */

// Helper to wait for camera actions panel to be ready
async function waitForCameraActionsPanel(page: Page) {
  // The container should exist in the HTML, wait for it
  try {
    await page.waitForSelector('#camera-actions-container', { timeout: 5000 });
  } catch (e) {
    // Container might not exist yet, wait for it to be created
    await page.waitForFunction(() => {
      return document.getElementById('camera-actions-container') !== null;
    }, { timeout: 15000 });
  }
  
  // Wait for the panel to be initialized (check for any child elements)
  await page.waitForFunction(() => {
    const container = document.getElementById('camera-actions-container');
    return container && container.children.length > 0 && 
           container.querySelector('.camera-actions-panel') !== null;
  }, { timeout: 15000 });
  
  // Wait for specific elements
  await page.waitForSelector('.camera-actions-panel', { timeout: 5000 });
  await page.waitForSelector('.camera-modes-grid', { timeout: 5000 });
  await page.waitForSelector('#gimbal-joystick', { timeout: 5000 });
  await page.waitForTimeout(500); // Give time for rendering
}

// Helper to mock backend responses
async function setupBackendMocks(page: Page) {
  // Mock /config endpoint
  await page.route('**/config', async (route) => {
    const requestUrl = route.request().url();
    const url = new URL(requestUrl);
    const backendApiPort = 8081;
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

  // Mock WHEP endpoint (WebRTC)
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

  // Mock camera-command endpoint
  await page.route('**/camera-command', async (route) => {
    const request = route.request();
    const postData = request.postDataJSON();
    
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'success',
        message: 'Camera command sent',
        target: '127.0.0.1:12345',
        sequence: 1,
        params: postData
      })
    });
  });

  // Mock set-camera-mode endpoint
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

test.describe('Camera Actions Panel - Screenshots', () => {
  test.beforeEach(async ({ page }) => {
    await setupBackendMocks(page);
    
    // Navigate to the page
    await page.goto('/webrtc/index.html');
    
    // Wait for video element to initialize first (camera actions loads after video)
    await page.waitForSelector('#video', { timeout: 10000 });
    
    // Wait for DOMContentLoaded and module to load
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000); // Give time for camera actions module to load and initialize
    
    // Check if container exists, if not wait for it
    const containerExists = await page.locator('#camera-actions-container').count() > 0;
    if (!containerExists) {
      // Wait for the container to be created
      await page.waitForFunction(() => {
        return document.getElementById('camera-actions-container') !== null;
      }, { timeout: 10000 });
    }
    
    // Now wait for camera actions panel to be fully initialized
    await waitForCameraActionsPanel(page);
  });

  test('should display camera actions panel', async ({ page }) => {
    const panel = page.locator('.camera-actions-panel');
    await expect(panel).toBeVisible();
    
    const screenshot = await page.screenshot({ 
      path: 'test-results/screenshots/camera-actions-01-panel-visible.png',
      fullPage: true 
    });
    await test.info().attach('camera-actions-01-panel-visible.png', {
      body: screenshot,
      contentType: 'image/png',
    });
  });

  test('should display camera modes grid', async ({ page }) => {
    const modesGrid = page.locator('.camera-modes-grid');
    await expect(modesGrid).toBeVisible();
    
    // Check that mode buttons are present
    const holdButton = page.locator('.mode-btn', { hasText: 'Hold' });
    const stowButton = page.locator('.mode-btn', { hasText: 'Stow' });
    const pilotButton = page.locator('.mode-btn', { hasText: 'Pilot' });
    
    await expect(holdButton).toBeVisible();
    await expect(stowButton).toBeVisible();
    await expect(pilotButton).toBeVisible();
    
    const screenshot = await page.screenshot({ 
      path: 'test-results/screenshots/camera-actions-02-modes-grid.png',
      fullPage: true 
    });
    await test.info().attach('camera-actions-02-modes-grid.png', {
      body: screenshot,
      contentType: 'image/png',
    });
  });

  test('should display gimbal controls', async ({ page }) => {
    const joystick = page.locator('#gimbal-joystick');
    const sensitivitySlider = page.locator('#sensitivity-slider');
    const sensitivityValue = page.locator('#sensitivity-value');
    
    await expect(joystick).toBeVisible();
    await expect(sensitivitySlider).toBeVisible();
    await expect(sensitivityValue).toBeVisible();
    await expect(sensitivityValue).toHaveText('100%');
    
    const screenshot = await page.screenshot({ 
      path: 'test-results/screenshots/camera-actions-03-gimbal-controls.png',
      fullPage: true 
    });
    await test.info().attach('camera-actions-03-gimbal-controls.png', {
      body: screenshot,
      contentType: 'image/png',
    });
  });

  test('should display zoom controls', async ({ page }) => {
    const zoomInBtn = page.locator('#zoom-in-btn');
    const zoomOutBtn = page.locator('#zoom-out-btn');
    
    await expect(zoomInBtn).toBeVisible();
    await expect(zoomOutBtn).toBeVisible();
    await expect(zoomInBtn).toHaveText('Zoom +');
    await expect(zoomOutBtn).toHaveText('Zoom -');
    
    const screenshot = await page.screenshot({ 
      path: 'test-results/screenshots/camera-actions-04-zoom-controls.png',
      fullPage: true 
    });
    await test.info().attach('camera-actions-04-zoom-controls.png', {
      body: screenshot,
      contentType: 'image/png',
    });
  });

  test('should display focus controls', async ({ page }) => {
    const focusNearBtn = page.locator('#focus-near-btn');
    const focusFarBtn = page.locator('#focus-far-btn');
    const focusInfinityBtn = page.locator('#focus-infinity-btn');
    const focusAutoBtn = page.locator('#focus-auto-btn');
    
    await expect(focusNearBtn).toBeVisible();
    await expect(focusFarBtn).toBeVisible();
    await expect(focusInfinityBtn).toBeVisible();
    await expect(focusAutoBtn).toBeVisible();
    
    const screenshot = await page.screenshot({ 
      path: 'test-results/screenshots/camera-actions-05-focus-controls.png',
      fullPage: true 
    });
    await test.info().attach('camera-actions-05-focus-controls.png', {
      body: screenshot,
      contentType: 'image/png',
    });
  });

  test('should send command when mode button is clicked', async ({ page }) => {
    const holdButton = page.locator('.mode-btn', { hasText: 'Hold' }).first();
    
    // Take screenshot before click
    const screenshotBefore = await page.screenshot({ 
      path: 'test-results/screenshots/camera-actions-06-before-mode-click.png',
      fullPage: true 
    });
    await test.info().attach('camera-actions-06-before-mode-click.png', {
      body: screenshotBefore,
      contentType: 'image/png',
    });
    
    // Set up request listener
    let requestData: any = null;
    page.on('request', (request) => {
      if (request.url().includes('/camera-command')) {
        requestData = request.postDataJSON();
      }
    });
    
    await holdButton.click();
    await page.waitForTimeout(200);
    
    // Verify command was sent (buttons are stateless, so no active class check)
    expect(requestData).not.toBeNull();
    expect(requestData.param1).toBe(0); // SetSystemMode command
    expect(requestData.param2).toBe(2); // Hold mode
    
    // Take screenshot after click
    const screenshotAfter = await page.screenshot({ 
      path: 'test-results/screenshots/camera-actions-07-after-mode-click.png',
      fullPage: true 
    });
    await test.info().attach('camera-actions-07-after-mode-click.png', {
      body: screenshotAfter,
      contentType: 'image/png',
    });
  });

  test('should update sensitivity slider', async ({ page }) => {
    const sensitivitySlider = page.locator('#sensitivity-slider');
    const sensitivityValue = page.locator('#sensitivity-value');
    
    // Take screenshot at default sensitivity (100%)
    const screenshotBefore = await page.screenshot({ 
      path: 'test-results/screenshots/camera-actions-08-sensitivity-100.png',
      fullPage: true 
    });
    await test.info().attach('camera-actions-08-sensitivity-100.png', {
      body: screenshotBefore,
      contentType: 'image/png',
    });
    
    // Change sensitivity to 50%
    await sensitivitySlider.fill('50');
    await page.waitForTimeout(100);
    
    await expect(sensitivityValue).toHaveText('50%');
    
    // Take screenshot at 50% sensitivity
    const screenshotAfter = await page.screenshot({ 
      path: 'test-results/screenshots/camera-actions-09-sensitivity-50.png',
      fullPage: true 
    });
    await test.info().attach('camera-actions-09-sensitivity-50.png', {
      body: screenshotAfter,
      contentType: 'image/png',
    });
  });

  test('should show zoom button pressed state', async ({ page }) => {
    const zoomInBtn = page.locator('#zoom-in-btn');
    
    // Take screenshot before press
    const screenshotBefore = await page.screenshot({ 
      path: 'test-results/screenshots/camera-actions-10-zoom-before-press.png',
      fullPage: true 
    });
    await test.info().attach('camera-actions-10-zoom-before-press.png', {
      body: screenshotBefore,
      contentType: 'image/png',
    });
    
    // Press and hold zoom button
    await zoomInBtn.dispatchEvent('mousedown');
    await page.waitForTimeout(100);
    
    // Take screenshot showing pressed state
    const screenshotPressed = await page.screenshot({ 
      path: 'test-results/screenshots/camera-actions-11-zoom-pressed.png',
      fullPage: true 
    });
    await test.info().attach('camera-actions-11-zoom-pressed.png', {
      body: screenshotPressed,
      contentType: 'image/png',
    });
    
    // Release button
    await zoomInBtn.dispatchEvent('mouseup');
    await page.waitForTimeout(100);
    
    // Take screenshot after release
    const screenshotAfter = await page.screenshot({ 
      path: 'test-results/screenshots/camera-actions-12-zoom-released.png',
      fullPage: true 
    });
    await test.info().attach('camera-actions-12-zoom-released.png', {
      body: screenshotAfter,
      contentType: 'image/png',
    });
  });

  test('should show focus button pressed state', async ({ page }) => {
    const focusAutoBtn = page.locator('#focus-auto-btn');
    
    // Take screenshot before press
    const screenshotBefore = await page.screenshot({ 
      path: 'test-results/screenshots/camera-actions-13-focus-before-press.png',
      fullPage: true 
    });
    await test.info().attach('camera-actions-13-focus-before-press.png', {
      body: screenshotBefore,
      contentType: 'image/png',
    });
    
    // Press and hold focus button
    await focusAutoBtn.dispatchEvent('mousedown');
    await page.waitForTimeout(100);
    
    // Take screenshot showing pressed state
    const screenshotPressed = await page.screenshot({ 
      path: 'test-results/screenshots/camera-actions-14-focus-pressed.png',
      fullPage: true 
    });
    await test.info().attach('camera-actions-14-focus-pressed.png', {
      body: screenshotPressed,
      contentType: 'image/png',
    });
    
    // Release button
    await focusAutoBtn.dispatchEvent('mouseup');
    await page.waitForTimeout(100);
    
    // Take screenshot after release
    const screenshotAfter = await page.screenshot({ 
      path: 'test-results/screenshots/camera-actions-15-focus-released.png',
      fullPage: true 
    });
    await test.info().attach('camera-actions-15-focus-released.png', {
      body: screenshotAfter,
      contentType: 'image/png',
    });
  });

  test('should display all camera mode buttons', async ({ page }) => {
    const expectedModes = [
      'Hold', 'Stow', 'Pilot', 'Nadir', 'GRR', 'Observation', 
      'EPR', '2D Scan', 'Nadir Scan', 'Ch0 A.Track', 'Ch1 A.Track',
      'Motors On', 'Motors Off'
    ];
    
    for (const modeText of expectedModes) {
      // Use exact text matching to avoid matching "Nadir" with "Nadir Scan"
      const button = page.locator('.mode-btn').filter({ hasText: new RegExp(`^${modeText}$`) });
      await expect(button.first()).toBeVisible();
    }
    
    const screenshot = await page.screenshot({ 
      path: 'test-results/screenshots/camera-actions-16-all-mode-buttons.png',
      fullPage: true 
    });
    await test.info().attach('camera-actions-16-all-mode-buttons.png', {
      body: screenshot,
      contentType: 'image/png',
    });
  });

  test('should show complete camera actions UI layout', async ({ page }) => {
    // Scroll to ensure everything is visible
    await page.evaluate(() => {
      const container = document.getElementById('camera-actions-container');
      if (container) {
        container.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
    await page.waitForTimeout(500);
    
    const screenshot = await page.screenshot({ 
      path: 'test-results/screenshots/camera-actions-17-complete-layout.png',
      fullPage: true 
    });
    await test.info().attach('camera-actions-17-complete-layout.png', {
      body: screenshot,
      contentType: 'image/png',
    });
  });
});

