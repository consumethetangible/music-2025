const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const sharp = require('sharp');
const fs = require('fs').promises;
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// Serve admin page
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// Scrape Bandcamp metadata
app.post('/api/scrape-bandcamp', async (req, res) => {
    try {
        const { url } = req.body;
        
        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }

        console.log(`Fetching metadata from: ${url}`);
        
        // Fetch the Bandcamp page
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        const html = response.data;
        const $ = cheerio.load(html);

        // Extract metadata from Bandcamp page
        const artist = $('#name-section h3 span a').text().trim() || 
                      $('meta[property="og:site_name"]').attr('content') ||
                      $('#band-name-location .title').text().trim();
        
        const album = $('#name-section h2.trackTitle').text().trim() || 
                     $('meta[property="og:title"]').attr('content');
        
        const artworkUrl = $('meta[property="og:image"]').attr('content') || 
                          $('#tralbumArt img').attr('src');

        if (!artist || !album) {
            return res.status(400).json({ error: 'Could not extract artist/album information' });
        }

        // Create a safe filename from artist name
        const safeFilename = artist.toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');

        res.json({
            artist,
            album,
            artworkUrl,
            suggestedFilename: safeFilename,
            originalUrl: url
        });

    } catch (error) {
        console.error('Error scraping Bandcamp:', error.message);
        res.status(500).json({ error: 'Failed to scrape Bandcamp page: ' + error.message });
    }
});

// Download and save artwork
app.post('/api/download-artwork', async (req, res) => {
    try {
        const { artworkUrl, filename } = req.body;

        if (!artworkUrl || !filename) {
            return res.status(400).json({ error: 'Artwork URL and filename are required' });
        }

        console.log(`Downloading artwork: ${artworkUrl}`);

        // Download the image
        const response = await axios.get(artworkUrl, {
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        const imageBuffer = Buffer.from(response.data);

        // Save as JPG
        const jpgPath = path.join(__dirname, `${filename}.jpg`);
        await sharp(imageBuffer)
            .jpeg({ quality: 90 })
            .toFile(jpgPath);

        // Also create WebP version
        const webpPath = path.join(__dirname, `${filename}.webp`);
        await sharp(imageBuffer)
            .webp({ quality: 85 })
            .toFile(webpPath);

        console.log(`Saved artwork: ${filename}.jpg and ${filename}.webp`);

        res.json({ 
            success: true, 
            jpgFile: `${filename}.jpg`,
            webpFile: `${filename}.webp`
        });

    } catch (error) {
        console.error('Error downloading artwork:', error.message);
        res.status(500).json({ error: 'Failed to download artwork: ' + error.message });
    }
});

// Add album to index.html
app.post('/api/add-album', async (req, res) => {
    try {
        const { artist, album, url, genre, filename, useWebP } = req.body;

        if (!artist || !album || !url || !genre || !filename) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        console.log(`Adding album: ${artist} - ${album} to genre: ${genre}`);

        // Read the index.html file
        const indexPath = path.join(__dirname, 'index.html');
        let html = await fs.readFile(indexPath, 'utf-8');

        // Create the album entry HTML
        const imgExt = useWebP ? 'webp' : 'jpg';
        const altText = `${artist} - ${album}`;
        
        let albumEntry;
        if (genre === 'archival') {
            // Archival format (box set style)
            albumEntry = `                <a class="release clickable" href="${url}" target="_blank" rel="noopener noreferrer">
                    <img loading="lazy" class="artwork" src="${filename}.${imgExt}" alt="${altText}">
                    <div class="overlay" aria-hidden="true"></div>
                    <div class="artist">${artist}</div>
                    <div class="album">${album}</div>
                </a>`;
        } else {
            // New releases format (vinyl style)
            if (useWebP) {
                albumEntry = `                <a class="release clickable" href="${url}" target="_blank" rel="noopener noreferrer">
                    <div class="tonearm"></div>
                    <picture>
                        <source type="image/webp" srcset="${filename}.webp">
                        <img loading="lazy" class="artwork" src="${filename}.webp" alt="${altText}">
                    </picture>
                    <div class="artist">${artist}</div>
                    <div class="album">${album}</div>
                </a>`;
            } else {
                albumEntry = `                <a class="release clickable" href="${url}" target="_blank" rel="noopener noreferrer">
                    <div class="tonearm"></div>
                    <img loading="lazy" class="artwork" src="${filename}.jpg" alt="${altText}">
                    <div class="artist">${artist}</div>
                    <div class="album">${album}</div>
                </a>`;
            }
        }

        // Find the correct genre section to insert into
        const genreMap = {
            'metal': 'metal',
            'stoner-psych': 'stoner-psych',
            'prog': 'prog',
            'rock-pop': 'rock-pop',
            'alternative': 'alternative',
            'archival': 'archival'
        };

        const genreClass = genreMap[genre];
        if (!genreClass) {
            return res.status(400).json({ error: 'Invalid genre' });
        }

        // Find the releases div for this genre
        const genrePattern = genreClass === 'archival' 
            ? /<div class="releases">(\s*)(?=.*?<div class="section archival">)/s
            : new RegExp(`<div class="releases" data-genre="${genreClass}">`);

        // Find the position to insert (just before the closing </div> of the releases container)
        let insertPosition;
        if (genreClass === 'archival') {
            const archivalMatch = html.match(/<div class="section archival">[\s\S]*?<div class="releases">([\s\S]*?)(?=\s*<\/div>\s*<\/div>)/);
            if (archivalMatch) {
                insertPosition = archivalMatch.index + archivalMatch[0].length;
            }
        } else {
            const genreMatch = html.match(new RegExp(`<div class="releases" data-genre="${genreClass}">[\\s\\S]*?(?=\\s*<\\/div>\\s*<!--)`));
            if (genreMatch) {
                insertPosition = genreMatch.index + genreMatch[0].length;
            }
        }

        if (!insertPosition) {
            return res.status(400).json({ error: `Could not find ${genre} section in index.html` });
        }

        // Insert the new album entry
        html = html.slice(0, insertPosition) + '\n' + albumEntry + '\n' + html.slice(insertPosition);

        // Write back to index.html
        await fs.writeFile(indexPath, html, 'utf-8');

        console.log(`Successfully added album to ${genre} section`);

        res.json({ success: true, message: `Album added to ${genre} section successfully!` });

    } catch (error) {
        console.error('Error adding album:', error.message);
        res.status(500).json({ error: 'Failed to add album: ' + error.message });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`Admin server running at http://localhost:${PORT}`);
    console.log(`Admin interface: http://localhost:${PORT}/admin`);
});
