require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SESSION_FILE = path.join(__dirname, 'session.json');
const BASE_URL = 'https://oneschoolglobal.softlinkhosting.com.au';

async function loginAndGetContext() {
  console.log('Starting Oliver Library automation (API mode)...');

  // Launch browser
  const browser = await chromium.launch({
    headless: false,
    slowMo: 100
  });

  // Check if we have a saved session
  let context;
  const hasSession = fs.existsSync(SESSION_FILE);

  if (hasSession) {
    console.log('Found saved session, loading...');
    context = await browser.newContext({ storageState: SESSION_FILE });
  } else {
    console.log('No saved session found');
    context = await browser.newContext();
  }

  const page = await context.newPage();

  try {
    // Navigate to Oliver home page
    console.log('Navigating to Oliver home page...');
    await page.goto(`${BASE_URL}/oliver/home/browse/list`);
    await page.waitForLoadState('networkidle');

    // Check if we need to log in
    const loginButton = await page.$('.login');

    if (loginButton) {
      console.log('Not logged in, starting login process...');

      // Click on login link
      await page.click('.login');

      // Wait for dialog content to appear
      await page.waitForSelector('#dialogContent', { timeout: 10000 });

      // Wait for login form to appear
      await page.waitForSelector('#loginForm_username', { timeout: 10000 });

      // Fill in login details
      await page.fill('#loginForm_username', process.env.OLIVER_USERNAME);
      await page.fill('#loginForm_password', process.env.OLIVER_PASSWORD);

      // Click submit button within the dialog
      await page.click('#dialogContent button[type="submit"]');

      // Wait for navigation after login
      await page.waitForLoadState('networkidle');
      console.log('Login successful!');

      // Wait for session to establish
      await page.waitForTimeout(3000);

      // Save the session state
      console.log('Saving session...');
      await context.storageState({ path: SESSION_FILE });
      console.log('Session saved!');
    } else {
      console.log('Already logged in!');
    }

    // Get cookies for API requests
    const cookies = await context.cookies();
    console.log(`Retrieved ${cookies.length} cookies`);

    // Navigate to Smart Cataloguing page to establish DWR session
    console.log('Navigating to Smart Cataloguing page to initialize DWR...');
    await page.goto(`${BASE_URL}/oliver/cataloguing/smartCataloguing.do`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Extract the DWR scriptSessionId from the page
    const scriptSessionId = await page.evaluate(() => {
      // DWR stores the session ID in dwr.engine._scriptSessionId
      if (typeof dwr !== 'undefined' && dwr.engine && dwr.engine._scriptSessionId) {
        return dwr.engine._scriptSessionId;
      }
      return null;
    });

    console.log('DWR scriptSessionId:', scriptSessionId);

    return { browser, context, page, cookies, scriptSessionId };
  } catch (error) {
    console.error('Error during login:', error.message);
    await browser.close();
    throw error;
  }
}

async function searchISBN(context, isbn, scriptSessionId, batchId = 1) {
  if (!scriptSessionId) {
    console.error('Error: No scriptSessionId available');
    return { success: false, error: 'No scriptSessionId' };
  }

  // Build DWR request payload
  const formData = new URLSearchParams();
  formData.append('callCount', '1');
  formData.append('nextReverseAjaxIndex', '0');
  formData.append('c0-scriptName', 'SmartCataloguing');
  formData.append('c0-methodName', 'resourceSearch');
  formData.append('c0-id', '0');
  formData.append('c0-param0', `string:${isbn}`);
  formData.append('batchId', batchId.toString());
  formData.append('instanceId', '0');
  formData.append('page', '/oliver/cataloguing/smartCataloguing.do');
  formData.append('scriptSessionId', scriptSessionId);

  try {
    const response = await context.request.post(
      `${BASE_URL}/oliver/dwr/call/plaincall/SmartCataloguing.resourceSearch.dwr`,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': '*/*',
          'Origin': BASE_URL,
          'Referer': `${BASE_URL}/oliver/cataloguing/smartCataloguing.do`
        },
        data: formData.toString()
      }
    );

    const responseText = await response.text();
    console.log('\n--- DWR Response ---');
    console.log(responseText);
    console.log('--- End Response ---\n');

    return {
      success: response.ok(),
      status: response.status(),
      data: responseText
    };
  } catch (error) {
    console.error(`Error searching ISBN ${isbn}:`, error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

async function main() {
  // Get ISBN from command line
  const isbn = process.argv[2];

  if (!isbn) {
    console.error('Error: Please provide an ISBN number');
    console.error('Usage: node index-api.js <ISBN>');
    process.exit(1);
  }

  let loginData;

  try {
    // Login and get context
    loginData = await loginAndGetContext();
    const { browser, context, page, cookies, scriptSessionId } = loginData;

    console.log(`\nSearching for ISBN: ${isbn}...`);

    // Perform API search
    const result = await searchISBN(context, isbn, scriptSessionId);

    console.log('\nResult:', result.success ? 'SUCCESS' : 'FAILED');
    console.log('Status:', result.status);

    // Keep browser open for inspection
    console.log('\nBrowser will remain open. Close it manually when done.');
    console.log('Press Ctrl+C to exit.');

  } catch (error) {
    console.error('Fatal error:', error);
    if (loginData?.browser) {
      await loginData.browser.close();
    }
    process.exit(1);
  }
}

// Run the automation
main();
