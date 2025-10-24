# Oliver Library Automation Tool

Web automation tool for the Oliver library system.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file based on `.env.example`:
```bash
cp .env.example .env
```

3. Edit `.env` and add your Oliver credentials:
```
OLIVER_USERNAME=your_username
OLIVER_PASSWORD=your_password
```

## Usage

### Single ISBN
Process a single ISBN:
```bash
node index.js 9780545139700
```

### Multiple ISBNs from File
Process multiple ISBNs from a text or CSV file:
```bash
node index.js isbns.txt
```

**File Format:**
- One ISBN per line, or
- Comma-separated ISBNs, or
- Semicolon-separated ISBNs
- Lines starting with `#` are treated as comments and ignored
- Empty lines are ignored

Example `isbns.txt`:
```
# My ISBN list
9780545139700
9780439139595
9780545162074
```

Or CSV format `isbns.csv`:
```
9780545139700,9780439139595,9780545162074
```

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

## Session Persistence

The script saves your login session to `session.json` after the first successful login. This means:
- **First run**: You'll see the full login process
- **Subsequent runs**: The script will use your saved session and skip the login (much faster!)
- If the session expires, the script will automatically detect it and log in again

To force a fresh login, simply delete the `session.json` file.
