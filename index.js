require("dotenv").config();
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const SESSION_FILE = path.join(__dirname, "session.json");
const BASE_URL = "https://oneschoolglobal.softlinkhosting.com.au";

let browser;
let context;
let page;

async function ensurePage() {
  if (!context) {
    throw new Error("Browser context is not initialised");
  }

  if (!page || page.isClosed()) {
    if (page?.isClosed()) {
      console.log("   → Current browser tab was closed, opening a new one...");
    } else {
      console.log("   → Opening browser tab...");
    }

    page = await context.newPage();
  }

  return page;
}

async function ensureLoggedIn() {
  await ensurePage();

  if (!page.url().includes("/oliver/welcome.do")) {
    await page.goto(`${BASE_URL}/oliver/welcome.do`);
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1000);
  }

  const loginButton = await page.$(".login");

  if (!loginButton) {
    return false;
  }

  console.log("   → Session expired, logging in again...");
  await page.click(".login");
  await page.waitForSelector("#dialogContent", { timeout: 10000 });
  await page.waitForSelector("#loginForm_username", { timeout: 10000 });
  await page.fill("#loginForm_username", process.env.OLIVER_USERNAME);
  await page.fill("#loginForm_password", process.env.OLIVER_PASSWORD);
  await page.click('#dialogContent button[type="submit"]');

  try {
    await page.waitForLoadState("networkidle", { timeout: 15000 });
  } catch (_) {
    // Oliver keeps long-running requests around; ignore load state timeouts.
  }

  console.log("   → Re-login successful!");
  await page.waitForTimeout(2000);
  await context.storageState({ path: SESSION_FILE });
  console.log("   → Session refreshed.");

  await page.goto(`${BASE_URL}/oliver/welcome.do`);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1000);

  return true;
}

async function navigateToSmartCataloguing(attempt = 1) {
  if (attempt > 3) {
    return false;
  }

  try {
    await ensurePage();

    if (!page.url().includes("/oliver/welcome.do")) {
      await page.goto(`${BASE_URL}/oliver/welcome.do`);
      await page.waitForLoadState("domcontentloaded");
      await page.waitForTimeout(1000);
    }

    await ensureLoggedIn();

    try {
      await page.waitForSelector("#menu_cataloguing", {
        timeout: 10000,
        state: "visible",
      });
    } catch (_) {
      console.log("   → Menu not visible, refreshing welcome page...");
      await page.goto(`${BASE_URL}/oliver/welcome.do`);
      await page.waitForLoadState("domcontentloaded");
      await page.waitForTimeout(1500);
      await page.waitForSelector("#menu_cataloguing", {
        timeout: 10000,
        state: "visible",
      });
    }

    const popupPromise = context
      .waitForEvent("page", { timeout: 2000 })
      .catch(() => null);

    await page.click("#menu_cataloguing");
    await page.waitForTimeout(800);
    await page.waitForSelector("#menuItem_smartCataloguing", {
      timeout: 5000,
      state: "visible",
    });
    await page.click("#menuItem_smartCataloguing");

    const popup = await popupPromise;
    if (popup) {
      page = popup;
    }

    try {
      await page.waitForLoadState("domcontentloaded", { timeout: 15000 });
    } catch (error) {
      if (page?.isClosed && page.isClosed()) {
        await ensurePage();
      }
    }
    if (page?.isClosed && page.isClosed()) {
      await ensurePage();
    }
    await page.waitForTimeout(1000);

    const loginButton = await page.$(".login");
    if (loginButton) {
      console.log("   → Navigation landed on login page, retrying...");
      await ensureLoggedIn();
      return navigateToSmartCataloguing(attempt + 1);
    }

    const finalUrl = page.url();
    if (finalUrl.includes("smartCataloguing") && !finalUrl.includes("permissionDenied")) {
      return true;
    }

    console.log(`   → Unexpected navigation target: ${finalUrl}`);
    if (page?.isClosed && page.isClosed()) {
      await ensurePage();
    }
    await page.waitForTimeout(1000);
    return navigateToSmartCataloguing(attempt + 1);
  } catch (error) {
    console.log(`   → Menu navigation failed: ${error.message}`);
    try {
      if (!page || (page.isClosed && page.isClosed())) {
        await ensurePage();
      }
      await page.waitForTimeout(1000);
    } catch (_) {
      // If we cannot pause on the page, just continue with the retry.
    }
    return navigateToSmartCataloguing(attempt + 1);
  }
}

async function searchSmartCataloguing(isbn, attempt = 1) {
  if (attempt > 3) {
    return false;
  }

  await page.waitForSelector("#smartCatSearchTerm", { timeout: 15000 });
  await page.fill("#smartCatSearchTerm", "");
  await page.fill("#smartCatSearchTerm", isbn);

  const popupPromise = context
    .waitForEvent("page", { timeout: 2000 })
    .catch(() => null);

  await page.click("#smartCatSearchButton");

  const popup = await popupPromise;
  if (popup) {
    page = popup;
  }

  try {
    await page.waitForLoadState("networkidle", { timeout: 15000 });
  } catch (error) {
    if (page?.isClosed && page.isClosed()) {
      console.log("   → Search closed the current window, rebuilding session...");
      await ensureLoggedIn();
      const reNav = await navigateToSmartCataloguing(attempt + 1);
      if (!reNav) {
        return false;
      }
      return searchSmartCataloguing(isbn, attempt + 1);
    }
    // Ignore load-state timeouts due to background polling requests.
  }

  await page.waitForTimeout(1500);

  let currentUrl = "";
  try {
    currentUrl = page.url();
  } catch (error) {
    if (page?.isClosed && page.isClosed()) {
      console.log("   → Lost the active page while checking the URL, retrying...");
      await ensureLoggedIn();
      const reNav = await navigateToSmartCataloguing(attempt + 1);
      if (!reNav) {
        return false;
      }
      return searchSmartCataloguing(isbn, attempt + 1);
    }
    throw error;
  }

  let loginButton = null;
  try {
    loginButton = await page.$(".login");
  } catch (error) {
    if (page?.isClosed && page.isClosed()) {
      console.log("   → Lost the page while checking login state, retrying...");
      await ensureLoggedIn();
      const reNav = await navigateToSmartCataloguing(attempt + 1);
      if (!reNav) {
        return false;
      }
      return searchSmartCataloguing(isbn, attempt + 1);
    }
    throw error;
  }

  if ((loginButton || !currentUrl.includes("smartCataloguing")) && attempt < 3) {
    console.log("   → Search redirected away from Smart Cataloguing, refreshing session...");
    await ensureLoggedIn();
    const reNav = await navigateToSmartCataloguing(attempt + 1);
    if (!reNav) {
      return false;
    }
    return searchSmartCataloguing(isbn, attempt + 1);
  }

  return currentUrl.includes("smartCataloguing");
}

async function processISBN(isbn) {
  console.log(`\n${"=".repeat(50)}`);
  console.log(`Processing ISBN: ${isbn}`);
  console.log("=".repeat(50));

  try {
    const navSuccess = await navigateToSmartCataloguing();
    if (!navSuccess) {
      console.log("❌ Failed to navigate to Smart Cataloguing page");
      return { isbn, status: "ERROR", error: "Navigation failed" };
    }

    const searchReady = await searchSmartCataloguing(isbn);
    if (!searchReady) {
      console.log("❌ Unable to complete search after session refresh attempts");
      return { isbn, status: "ERROR", error: "Search failed after re-login" };
    }

    const saveButton = await page.$("#smartCatSaveResource");
    if (saveButton) {
      const isDisabled = await saveButton.isDisabled();
      if (isDisabled) {
        console.log("⏭️  Resource already exists in database");
        return { isbn, status: "ALREADY_EXISTS" };
      }

      console.log("✅ Resource found! Clicking save button...");
      await saveButton.click();

      try {
        await page.waitForLoadState("networkidle", { timeout: 10000 });
      } catch (_) {
        // Ignore load-state timeouts; data saves even if background polling continues.
      }

      await page.waitForTimeout(1000);
      console.log("✅ Resource saved successfully!");
      return { isbn, status: "ADDED" };
    }

    const notFoundMsg = await page.$(".smartCatFoundMsg");
    if (notFoundMsg) {
      console.log("❌ ISBN not found - incorrect or invalid ISBN");
      return { isbn, status: "NOT_FOUND" };
    }

    console.log("⚠️  Warning: Unexpected state after search");
    return { isbn, status: "UNKNOWN" };
  } catch (error) {
    console.error(`❌ Error processing ISBN ${isbn}: ${error.message}`);
    if (page?.isClosed && page.isClosed()) {
      console.log("   → Page closed unexpectedly; it will be recreated on the next iteration.");
    }
    return { isbn, status: "ERROR", error: error.message };
  }
}

async function runOliverAutomation(isbns) {
  console.log("Starting Oliver Library automation...");

  if (!process.env.OLIVER_USERNAME || !process.env.OLIVER_PASSWORD) {
    console.error("Error: Please create a .env file with OLIVER_USERNAME and OLIVER_PASSWORD");
    console.error("See .env.example for reference");
    process.exit(1);
  }

  if (!isbns || isbns.length === 0) {
    console.error("Error: No ISBNs provided");
    console.error("Usage: node index.js <ISBN or file path>");
    process.exit(1);
  }

  console.log(`Processing ${isbns.length} ISBN(s)...`);

  browser = await chromium.launch({
    headless: false,
    slowMo: 100,
  });

  const hasSession = fs.existsSync(SESSION_FILE);

  if (hasSession) {
    console.log("Found saved session, loading...");
    context = await browser.newContext({ storageState: SESSION_FILE });
  } else {
    console.log("No saved session found");
    context = await browser.newContext();
  }

  page = await context.newPage();

  try {
    console.log("Navigating to Oliver home page...");
    await page.goto(`${BASE_URL}/oliver/home/browse/list`);
    await page.waitForLoadState("domcontentloaded");

    const loginButton = await page.$(".login");

    if (loginButton) {
      console.log("Not logged in, starting login process...");
      await page.click(".login");
      await page.waitForSelector("#dialogContent", { timeout: 10000 });
      console.log("Login dialog appeared");

      await page.waitForSelector("#loginForm_username", { timeout: 10000 });
      console.log("Login form ready");

      console.log("Filling in login credentials...");
      await page.fill("#loginForm_username", process.env.OLIVER_USERNAME);
      await page.fill("#loginForm_password", process.env.OLIVER_PASSWORD);

      console.log("Submitting login form...");
      await page.click('#dialogContent button[type="submit"]');

      try {
        await page.waitForLoadState("networkidle", { timeout: 15000 });
      } catch (_) {
        // Ignore load-state timeouts triggered by background requests.
      }

      console.log("Login successful!");
      console.log("Waiting for session to fully establish...");
      await page.waitForTimeout(5000);

      console.log("Saving session...");
      await context.storageState({ path: SESSION_FILE });
      console.log("Session saved!");
    } else {
      console.log("Already logged in!");
      console.log("Waiting for session to fully activate...");
      await page.waitForTimeout(5000);
    }

    await ensureLoggedIn();

    const results = [];
    for (let i = 0; i < isbns.length; i++) {
      console.log(`\nProgress: ${i + 1}/${isbns.length}`);
      const result = await processISBN(isbns[i]);
      results.push(result);
    }

    console.log("\n" + "=".repeat(70));
    console.log("PROCESSING COMPLETE - REPORT");
    console.log("=".repeat(70));

    const added = results.filter((r) => r.status === "ADDED");
    const alreadyExists = results.filter((r) => r.status === "ALREADY_EXISTS");
    const notFound = results.filter((r) => r.status === "NOT_FOUND");
    const errors = results.filter((r) => r.status === "ERROR");
    const unknown = results.filter((r) => r.status === "UNKNOWN");

    console.log(`\n✅ ADDED (${added.length}):`);
    if (added.length > 0) {
      added.forEach((r) => console.log(`   - ${r.isbn}`));
    } else {
      console.log("   None");
    }

    console.log(`\n⏭️  ALREADY EXISTS (${alreadyExists.length}):`);
    if (alreadyExists.length > 0) {
      alreadyExists.forEach((r) => console.log(`   - ${r.isbn}`));
    } else {
      console.log("   None");
    }

    console.log(`\n❌ NOT FOUND (${notFound.length}):`);
    if (notFound.length > 0) {
      notFound.forEach((r) => console.log(`   - ${r.isbn}`));
    } else {
      console.log("   None");
    }

    if (errors.length > 0) {
      console.log(`\n❌ ERRORS (${errors.length}):`);
      errors.forEach((r) => console.log(`   - ${r.isbn}: ${r.error}`));
    }

    if (unknown.length > 0) {
      console.log(`\n⚠️  UNKNOWN (${unknown.length}):`);
      unknown.forEach((r) => console.log(`   - ${r.isbn}`));
    }

    console.log("\n" + "=".repeat(70));
    console.log(
      `Total: ${results.length} | Added: ${added.length} | Already Exists: ${alreadyExists.length} | Not Found: ${notFound.length}`
    );
    console.log("=".repeat(70));

    const reportPath = path.join(__dirname, "report.txt");
    const reportContent = `Oliver Library Upload Report
Generated: ${new Date().toLocaleString()}

SUMMARY:
- Total ISBNs Processed: ${results.length}
- Added: ${added.length}
- Already Exists: ${alreadyExists.length}
- Not Found: ${notFound.length}
- Errors: ${errors.length}
- Unknown: ${unknown.length}

ADDED (${added.length}):
${added.map((r) => r.isbn).join("\n") || "None"}

ALREADY EXISTS (${alreadyExists.length}):
${alreadyExists.map((r) => r.isbn).join("\n") || "None"}

NOT FOUND (${notFound.length}):
${notFound.map((r) => r.isbn).join("\n") || "None"}

${errors.length > 0 ? `ERRORS (${errors.length}):\n${errors
      .map((r) => `${r.isbn}: ${r.error}`)
      .join("\n")}` : ""}

${unknown.length > 0 ? `UNKNOWN (${unknown.length}):\n${unknown
      .map((r) => r.isbn)
      .join("\n")}` : ""}
`;

    fs.writeFileSync(reportPath, reportContent);
    console.log(`\n📄 Report saved to: ${reportPath}`);

    console.log("\nBrowser will remain open. Close it manually when done.");
  } catch (error) {
    console.error("Error during automation:", error.message);
    console.error("Stack trace:", error.stack);
    if (browser) {
      await browser.close();
    }
    process.exit(1);
  }
}

const input = process.argv[2];

if (!input) {
  console.error("Error: Please provide an ISBN or file path");
  console.error("Usage:");
  console.error("  Single ISBN:  node index.js 9780545139700");
  console.error("  File:         node index.js isbns.txt");
  console.error("  File:         node index.js isbns.csv");
  process.exit(1);
}

let isbns = [];

if (fs.existsSync(input)) {
  console.log(`Reading ISBNs from file: ${input}`);
  const content = fs.readFileSync(input, "utf-8");

  isbns = content
    .split(/[\n,;]+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  console.log(`Found ${isbns.length} ISBNs in file`);
} else {
  isbns = [input];
}

runOliverAutomation(isbns);
