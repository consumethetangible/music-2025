# Music 2025 Admin Interface

A simple web interface for adding new albums to your Music 2025 site.

## Setup

1. **Install Node.js dependencies:**
   ```bash
   npm install
   ```

2. **Start the admin server:**
   ```bash
   npm start
   ```

   For development with auto-reload:
   ```bash
   npm run dev
   ```

3. **Open the admin interface:**
   Open your browser to: `http://localhost:3000/admin`

## How to Use

1. **Enter the Bandcamp URL** of the album you want to add
2. **Select the genre** where this album should appear
3. **Click "Fetch Album Info"** to scrape metadata from Bandcamp
4. **Review the preview** to make sure everything looks correct
5. **Click "Add to Site"** to:
   - Download the album artwork (saves as both .jpg and .webp)
   - Add the entry to your index.html in the correct genre section
   - Everything is done automatically!

## Genre Sections

- **Metal**: Heavy, doom, black metal, etc.
- **Stoner & Psych**: Stoner rock, psychedelic rock
- **Prog**: Progressive rock, jazz fusion
- **Rock & Pop**: Rock, punk, indie rock
- **Alternative**: Experimental, ambient, alternative
- **Archival / Reissues**: Box sets and reissues

## What It Does

The admin interface will:
1. Scrape artist, album name, and artwork from the Bandcamp page
2. Download and optimize the artwork (JPG + WebP formats)
3. Generate the HTML entry with proper formatting
4. Insert it into the correct genre section of your index.html
5. Maintain all the existing styling and functionality

## Files Created

- `package.json` - Node.js dependencies
- `server.js` - Backend server that handles scraping and file operations  
- `admin.html` - Web interface for adding albums

## Troubleshooting

**Port already in use?**
Edit `server.js` and change `const PORT = 3000` to a different port.

**Can't fetch Bandcamp data?**
Make sure the URL is a valid Bandcamp link (should contain "bandcamp.com").

**Album not appearing?**
Check the terminal where the server is running for any error messages.

## Security Note

This is a local development tool. Do **not** deploy this to a public server without adding authentication, as anyone could modify your site!
