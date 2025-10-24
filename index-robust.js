require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SESSION_FILE = path.join(__dirname, 'session.json');
const BASE_URL = 'https://oneschoolglobal.softlinkhosting.com.au';

// Global context and page to maintain session
let browser, context, page;

async function ensureLoggedIn() {
  console.log('   → Checking login status...');

  // Navigate to welcome page (where the menu is)
  const currentUrl = page.url();
  if (!currentUrl.includes('/oliver/welcome.do')) {
    console.log('   → Navigating to welcome page...');
    await page.goto(`${BASE_URL}/oliver/welcome.do`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
  }

  const loginButton = await page.$('.login');

  if (loginButton) {
    console.log('   → Not logged in, authenticating...');

    await page.click('.login');
    await page.waitForSelector('#dialogContent', { timeout: 10000 });
    await page.waitForSelector('#loginForm_username', { timeout: 10000 });

    await page.fill('#loginForm_username', process.env.OLIVER_USERNAME);
    await page.fill('#loginForm_password', process.env.OLIVER_PASSWORD);
    await page.click('#dialogContent button[type="submit"]');

    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    console.log('   → Login successful!');

    // Save session
    await context.storageState({ path: SESSION_FILE });

    // Navigate to welcome page after login
    await page.goto(`${BASE_URL}/oliver/welcome.do`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    return true;
  } else {
    console.log('   → Already logged in');
    return false;
  }
}

async function navigateToSmartCataloguing() {
  // Make sure we're logged in and on welcome page (where menu is)
  await ensureLoggedIn();

  // Double-check we're on welcome page before clicking menus
  let currentUrl = page.url();
  if (!currentUrl.includes('/oliver/welcome.do')) {
    console.log('   → Not on welcome page after login check, navigating there...');
    await page.goto(`${BASE_URL}/oliver/welcome.do`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
  }

  // Wait for the cataloguing menu to be available
  console.log('   → Waiting for menu to be available...');
  try {
    await page.waitForSelector('#menu_cataloguing', { timeout: 10000, state: 'visible' });
  } catch (error) {
    console.log('   → Menu not found, forcing page reload...');
    await page.goto(`${BASE_URL}/oliver/welcome.do`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    try {
      await page.waitForSelector('#menu_cataloguing', { timeout: 10000, state: 'visible' });
    } catch (retryError) {
      console.log('   → Menu still not found after reload');
      return false;
    }
  }

  // Click through menu
  try {
    console.log('   → Clicking Cataloguing menu...');
    await page.click('#menu_cataloguing');
    await page.waitForTimeout(800);

    console.log('   → Clicking Smart Cataloguing submenu...');
    await page.waitForSelector('#menuItem_smartCataloguing', { timeout: 5000, state: 'visible' });
    await page.click('#menuItem_smartCataloguing');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Verify we're there
    const url = page.url();
    if (url.includes('smartCataloguing') && !url.includes('permissionDenied')) {
      console.log('   → Successfully navigated to Smart Cataloguing');
      return true;
    } else {
      console.log(`   → Navigation failed, ended up at: ${url}`);
      return false;
    }
  } catch (error) {
    console.log(`   → Menu navigation error: ${error.message}`);
    return false;
  }
}

async function processISBN(isbn) {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Processing ISBN: ${isbn}`);
  console.log('='.repeat(50));

  try {
    // Navigate to cataloguing page with login check
    const success = await navigateToSmartCataloguing();

    if (!success) {
      console.log('❌ Failed to navigate to Smart Cataloguing page');
      return { isbn, status: 'ERROR', error: 'Navigation failed' };
    }

    // Check we're still on the right page (sometimes redirects to home)
    let currentUrl = page.url();
    if (!currentUrl.includes('smartCataloguing')) {
      console.log('   → Detected redirect to home, re-navigating...');
      const retry = await navigateToSmartCataloguing();
      if (!retry) {
        console.log('❌ Failed to re-navigate');
        return { isbn, status: 'ERROR', error: 'Navigation failed after redirect' };
      }
    }

    // Wait for search field
    await page.waitForSelector('#smartCatSearchTerm', { timeout: 10000 });

    // Clear and enter ISBN
    await page.fill('#smartCatSearchTerm', '');
    await page.fill('#smartCatSearchTerm', isbn);

    // Click search
    await page.click('#smartCatSearchButton');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);

    // Check if we got redirected to home after search
    currentUrl = page.url();
    if (!currentUrl.includes('smartCataloguing') && currentUrl.includes('/oliver/home/')) {
      console.log('   → Got redirected to home after search, re-navigating and retrying...');
      const retry = await navigateToSmartCataloguing();
      if (!retry) {
        return { isbn, status: 'ERROR', error: 'Redirected to home after search' };
      }

      // Retry the search
      await page.waitForSelector('#smartCatSearchTerm', { timeout: 10000 });
      await page.fill('#smartCatSearchTerm', '');
      await page.fill('#smartCatSearchTerm', isbn);
      await page.click('#smartCatSearchButton');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1500);
    }

    // Check results - save button first (most definitive)
    const saveButton = await page.$('#smartCatSaveResource');
    if (saveButton) {
      const isDisabled = await saveButton.isDisabled();
      if (isDisabled) {
        console.log('⏭️  Already exists in database');
        return { isbn, status: 'ALREADY_EXISTS' };
      } else {
        console.log('✅ Found! Clicking save...');
        await saveButton.click();
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(1000);
        console.log('✅ Saved successfully!');
        return { isbn, status: 'ADDED' };
      }
    }

    // Check for not found message
    const notFoundMsg = await page.$('.smartCatFoundMsg');
    if (notFoundMsg) {
      console.log('❌ Not found - invalid ISBN');
      return { isbn, status: 'NOT_FOUND' };
    }

    console.log('⚠️  Unknown state');
    return { isbn, status: 'UNKNOWN' };

  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    return { isbn, status: 'ERROR', error: error.message };
  }
}

async function main() {
  // Check credentials
  if (!process.env.OLIVER_USERNAME || !process.env.OLIVER_PASSWORD) {
    console.error('Error: Missing OLIVER_USERNAME or OLIVER_PASSWORD in .env file');
    process.exit(1);
  }

  // Get input
  const input = process.argv[2];
  if (!input) {
    console.error('Error: Please provide an ISBN or file path');
    console.error('Usage: node index-robust.js <ISBN or file>');
    process.exit(1);
  }

  // Parse ISBNs
  let isbns = [];
  if (fs.existsSync(input)) {
    console.log(`Reading ISBNs from: ${input}`);
    const content = fs.readFileSync(input, 'utf-8');
    isbns = content
      .split(/[\n,;]+/)
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('#'));
    console.log(`Found ${isbns.length} ISBNs`);
  } else {
    isbns = [input];
  }

  if (isbns.length === 0) {
    console.error('Error: No ISBNs to process');
    process.exit(1);
  }

  try {
    // Launch browser
    console.log('Starting browser...');
    browser = await chromium.launch({
      headless: false,
      slowMo: 50
    });

    // Load session if exists
    const hasSession = fs.existsSync(SESSION_FILE);
    if (hasSession) {
      console.log('Loading saved session...');
      context = await browser.newContext({ storageState: SESSION_FILE });
    } else {
      context = await browser.newContext();
    }

    page = await context.newPage();

    // Initial login check
    console.log('Performing initial login check...');
    await ensureLoggedIn();

    // Process each ISBN
    const results = [];
    for (let i = 0; i < isbns.length; i++) {
      console.log(`\n[${i + 1}/${isbns.length}]`);
      const result = await processISBN(isbns[i]);
      results.push(result);

      // Small delay between ISBNs
      if (i < isbns.length - 1) {
        await page.waitForTimeout(500);
      }
    }

    // Generate report
    console.log('\n' + '='.repeat(70));
    console.log('PROCESSING COMPLETE - REPORT');
    console.log('='.repeat(70));

    const added = results.filter(r => r.status === 'ADDED');
    const alreadyExists = results.filter(r => r.status === 'ALREADY_EXISTS');
    const notFound = results.filter(r => r.status === 'NOT_FOUND');
    const errors = results.filter(r => r.status === 'ERROR');
    const unknown = results.filter(r => r.status === 'UNKNOWN');

    console.log(`\n✅ ADDED (${added.length}):`);
    added.length > 0 ? added.forEach(r => console.log(`   - ${r.isbn}`)) : console.log('   None');

    console.log(`\n⏭️  ALREADY EXISTS (${alreadyExists.length}):`);
    alreadyExists.length > 0 ? alreadyExists.forEach(r => console.log(`   - ${r.isbn}`)) : console.log('   None');

    console.log(`\n❌ NOT FOUND (${notFound.length}):`);
    notFound.length > 0 ? notFound.forEach(r => console.log(`   - ${r.isbn}`)) : console.log('   None');

    if (errors.length > 0) {
      console.log(`\n❌ ERRORS (${errors.length}):`);
      errors.forEach(r => console.log(`   - ${r.isbn}: ${r.error}`));
    }

    if (unknown.length > 0) {
      console.log(`\n⚠️  UNKNOWN (${unknown.length}):`);
      unknown.forEach(r => console.log(`   - ${r.isbn}`));
    }

    console.log('\n' + '='.repeat(70));
    console.log(`Total: ${results.length} | Added: ${added.length} | Exists: ${alreadyExists.length} | Not Found: ${notFound.length}`);
    console.log('='.repeat(70));

    // Save report
    const reportPath = path.join(__dirname, 'report.txt');
    const reportContent = `Oliver Library Upload Report
Generated: ${new Date().toLocaleString()}

SUMMARY:
- Total: ${results.length}
- Added: ${added.length}
- Already Exists: ${alreadyExists.length}
- Not Found: ${notFound.length}
- Errors: ${errors.length}
- Unknown: ${unknown.length}

ADDED (${added.length}):
${added.map(r => r.isbn).join('\n') || 'None'}

ALREADY EXISTS (${alreadyExists.length}):
${alreadyExists.map(r => r.isbn).join('\n') || 'None'}

NOT FOUND (${notFound.length}):
${notFound.map(r => r.isbn).join('\n') || 'None'}

${errors.length > 0 ? `ERRORS (${errors.length}):\n${errors.map(r => `${r.isbn}: ${r.error}`).join('\n')}` : ''}

${unknown.length > 0 ? `UNKNOWN (${unknown.length}):\n${unknown.map(r => r.isbn).join('\n')}` : ''}
`;

    fs.writeFileSync(reportPath, reportContent);
    console.log(`\n📄 Report saved to: ${reportPath}`);

    console.log('\nBrowser will remain open. Close it when done.');

  } catch (error) {
    console.error('\nFatal error:', error.message);
    console.error(error.stack);
    if (browser) {
      await browser.close();
    }
    process.exit(1);
  }
}

main();
