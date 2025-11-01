# Oliver Library Automation Tool

Web automation tool for the Oliver library system to automatically catalogue books using ISBN numbers.

## Quick Start Guide (Windows)

**New to this? Follow these steps:**

1. **Install Node.js**: Download from [nodejs.org](https://nodejs.org/) and run the installer (check "Add to PATH")
2. **Download this tool**: Extract the ZIP file to a folder on your computer
3. **Open Command Prompt**: Navigate to the folder, click in the address bar, type `cmd`, press Enter
4. **Install dependencies**: Type `npm install` and press Enter
5. **Set up credentials**:
   - Type `copy .env.example .env` and press Enter
   - Type `notepad .env` and press Enter
   - Replace the username and password with your Oliver credentials
   - Save and close Notepad
6. **Create your ISBN list**: Create a file called `isbns.txt` with one ISBN per line (use Notepad)
7. **Run the tool**: Type `node index.js isbns.txt` and press Enter

That's it! The browser will open and start processing your ISBNs automatically.

---

## Prerequisites

- **Node.js** (version 16 or higher) - [Download here](https://nodejs.org/)
- **Oliver Library System** account with cataloguing permissions

## Setup

### 1. Install Dependencies

Open Command Prompt or PowerShell in the project folder and run:

**Windows (PowerShell/CMD):**
```powershell
npm install
```

**macOS/Linux:**
```bash
npm install
```

### 2. Configure Your Credentials

**Option A: Copy and edit the example file (Recommended)**

**Windows (PowerShell):**
```powershell
copy .env.example .env
notepad .env
```

**Windows (Command Prompt):**
```cmd
copy .env.example .env
notepad .env
```

**macOS/Linux:**
```bash
cp .env.example .env
nano .env
```

**Option B: Create manually**

Create a new file named `.env` (note the dot at the start) in the project folder with:
```
OLIVER_USERNAME=your_username_here
OLIVER_PASSWORD=your_password_here
```

Replace `your_username_here` and `your_password_here` with your actual Oliver credentials.

## Usage

### Single ISBN

Process a single ISBN:

**Windows:**
```powershell
node index.js 9780545139700
```

**macOS/Linux:**
```bash
node index.js 9780545139700
```

### Multiple ISBNs from File

Process multiple ISBNs from a text or CSV file:

**Windows:**
```powershell
node index.js isbns.txt
```

**macOS/Linux:**
```bash
node index.js isbns.txt
```

### Creating an ISBN File

Create a text file (e.g., `isbns.txt`) with your ISBNs. The file can be created with **Notepad** on Windows or any text editor.

**Supported Formats:**
- One ISBN per line (recommended)
- Comma-separated ISBNs
- Semicolon-separated ISBNs
- Lines starting with `#` are treated as comments and ignored
- Empty lines are ignored

**Example `isbns.txt`:**
```
# My Book List for January 2024
9780545139700
9780439139595
9780545162074
```

**Or CSV format `isbns.csv`:**
```
9780545139700,9780439139595,9780545162074
```

**Tip:** You can copy ISBNs from Excel and paste them into a text file (one per line).

### How It Works

The script will:
1. Navigate to Oliver home page
2. Check if you're already logged in (using saved session)
3. If not logged in, fill in credentials from .env and log in
4. Save the session for future runs
5. For each ISBN:
   - Navigate to the Smart Cataloguing page
   - Enter the ISBN and search
   - Determine the result:
     - ✅ **ADDED**: Resource found and successfully added to database
     - ⏭️ **ALREADY EXISTS**: Resource already in the database (save button disabled)
     - ❌ **NOT FOUND**: ISBN not found or invalid
6. Display a summary report in the console
7. Save a detailed report to `report.txt`

The browser will remain open after completion so you can review the results.

## Reports

After processing, a detailed report is generated:
- **Console output**: Summary with colored indicators
- **report.txt**: Detailed text file with all results categorized by status

## Advanced Options

### Headless Mode

By default, you'll see the browser window as the script works. For faster, background processing without a visible browser:

**Windows (PowerShell):**
```powershell
$env:HEADLESS="true"; node index.js isbns.txt
```

**Windows (Command Prompt):**
```cmd
set HEADLESS=true && node index.js isbns.txt
```

**macOS/Linux:**
```bash
HEADLESS=true node index.js isbns.txt
```

**Benefits of headless mode:**
- ⚡ Faster performance
- 💻 Less resource usage
- 🔄 Better for automated/scheduled runs

**When to use visible browser mode (default):**
- 🐛 Troubleshooting issues
- 👀 Watching progress
- 📖 Learning how the tool works

### Debug Mode

For detailed logging to troubleshoot problems:

**Windows (PowerShell):**
```powershell
$env:DEBUG="1"; node index.js isbns.txt
```

**Windows (Command Prompt):**
```cmd
set DEBUG=1 && node index.js isbns.txt
```

**macOS/Linux:**
```bash
DEBUG=1 node index.js isbns.txt
```

**Combine headless and debug mode:**

**Windows (PowerShell):**
```powershell
$env:HEADLESS="true"; $env:DEBUG="1"; node index.js isbns.txt
```

**Windows (Command Prompt):**
```cmd
set HEADLESS=true && set DEBUG=1 && node index.js isbns.txt
```

**macOS/Linux:**
```bash
DEBUG=1 HEADLESS=true node index.js isbns.txt
```

### Session Persistence

The script saves your login session to `session.json` after the first successful login. This means:
- **First run**: You'll see the full login process
- **Subsequent runs**: The script will use your saved session and skip the login (much faster!)
- If the session expires, the script will automatically detect it and log in again

**To force a fresh login:**

**Windows (File Explorer):** Find and delete `session.json` in the project folder

**Windows (PowerShell):**
```powershell
Remove-Item session.json
```

**Windows (Command Prompt):**
```cmd
del session.json
```

**macOS/Linux:**
```bash
rm session.json
```

## Troubleshooting

### Common Issues

**"node is not recognized as an internal or external command"**
- Node.js is not installed or not in your PATH
- Solution: Download and install Node.js from [nodejs.org](https://nodejs.org/)
- Make sure to check "Add to PATH" during installation
- Restart Command Prompt/PowerShell after installation

**"Cannot find module 'playwright'" or similar errors**
- Dependencies not installed
- Solution: Run `npm install` in the project folder

**".env file not found" or login fails**
- Credentials not configured properly
- Solution: Make sure `.env` file exists and contains correct credentials
- On Windows, make sure the file is named `.env` (not `.env.txt`)
- To check: In File Explorer, go to View → Show → File name extensions

**Script hangs or gets stuck**
- Try running with debug mode to see where it's stuck:
  ```powershell
  $env:DEBUG="1"; node index.js isbns.txt
  ```
- Delete `session.json` and try again for a fresh login

**Browser closes immediately**
- This is normal behavior when the script encounters an error
- Run with debug mode to see the error details

**Need help?**
- Run with `DEBUG=1` to see detailed logs
- Check the console output for error messages
- Delete `session.json` if you suspect session issues

## Tips for Windows Users

### Opening Command Prompt in the Project Folder

**Quick Method:**
1. Open File Explorer and navigate to the project folder
2. Click in the address bar and type `cmd`
3. Press Enter

**PowerShell Method:**
1. Open File Explorer and navigate to the project folder
2. Hold `Shift` and right-click in the folder
3. Select "Open PowerShell window here"

### Viewing Hidden Files (to see .env)

1. Open File Explorer
2. Click the **View** tab
3. Check **Hidden items**
4. Check **File name extensions**

This helps you verify that your `.env` file is named correctly (not `.env.txt`).
