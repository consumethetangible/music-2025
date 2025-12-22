const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const sharp = require('sharp');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(__dirname));

// Serve admin interface
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// API endpoint to scrape Bandcamp
app.post('/api/scrape-bandcamp', async (req, res) => {
    try {
        const { url } = req.body;
        
        if (!url || !url.includes('bandcamp.com')) {
            return res.status(400).json({ error: 'Invalid Bandcamp URL' });
        }

        const response = await axios.get(url);
        const $ = cheerio.load(response.data);

        // Extract artist name (multiple fallbacks)
        let artist = $('#name-section h3 span a').text().trim();
        if (!artist) {
            artist = $('meta[property="og:site_name"]').attr('content');
        }
        if (!artist) {
            artist = $('#band-name-location .title').text().trim();
        }

        // Extract album name
        let album = $('#name-section h2.trackTitle').text().trim();
        if (!album) {
            const ogTitle = $('meta[property="og:title"]').attr('content');
            if (ogTitle) {
                album = ogTitle;
            }
        }

        // Extract artwork URL
        let artworkUrl = $('meta[property="og:image"]').attr('content');
        if (!artworkUrl) {
            artworkUrl = $('#tralbumArt img').attr('src');
        }

        if (!artist || !album || !artworkUrl) {
            return res.status(400).json({ 
                error: 'Could not extract album information',
                found: { artist, album, artworkUrl }
            });
        }

        res.json({
            artist: artist.trim(),
            album: album.trim(),
            artworkUrl: artworkUrl,
            bandcampUrl: url
        });

    } catch (error) {
        console.error('Scraping error:', error);
        res.status(500).json({ error: 'Failed to scrape Bandcamp URL' });
    }
});

// API endpoint to download and process artwork
app.post('/api/download-artwork', async (req, res) => {
    try {
        const { artworkUrl, artist, album } = req.body;

        // Create a safe filename
        const safeFilename = `${artist.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${album.toLowerCase().replace(/[^a-z0-9]/g, '-')}`.replace(/-+/g, '-');

        // Download the image
        const imageResponse = await axios.get(artworkUrl, { responseType: 'arraybuffer' });
        const imageBuffer = Buffer.from(imageResponse.data);

        // Process and save as JPG
        const jpgPath = path.join(__dirname, `${safeFilename}.jpg`);
        await sharp(imageBuffer)
            .resize(800, 800, { fit: 'cover' })
            .jpeg({ quality: 85 })
            .toFile(jpgPath);

        // Process and save as WebP
        const webpPath = path.join(__dirname, `${safeFilename}.webp`);
        await sharp(imageBuffer)
            .resize(800, 800, { fit: 'cover' })
            .webp({ quality: 85 })
            .toFile(webpPath);

        res.json({
            jpgFilename: `${safeFilename}.jpg`,
            webpFilename: `${safeFilename}.webp`
        });

    } catch (error) {
        console.error('Download error:', error);
        res.status(500).json({ error: 'Failed to download artwork' });
    }
});

// API endpoint to add album to index.html
app.post('/api/add-album', async (req, res) => {
    try {
        const { artist, album, bandcampUrl, genre, jpgFilename, webpFilename } = req.body;

        // Map genre to section class
        const genreMap = {
            'metal': 'metal',
            'stoner-psych': 'stoner-psych',
            'prog': 'prog',
            'rock-pop': 'rock-pop',
            'alternative': 'alternative',
            'archival': 'archival'
        };

        // Map genre to section name (for HTML comments)
        const genreNameMap = {
            'metal': 'Metal',
            'stoner-psych': 'Stoner & Psych',
            'prog': 'Prog',
            'rock-pop': 'Rock & Pop',
            'alternative': 'Alternative',
            'archival': 'Archival / Reissues'
        };

        const genreClass = genreMap[genre];
        const genreName = genreNameMap[genre];
        if (!genreClass || !genreName) {
            return res.status(400).json({ error: 'Invalid genre' });
        }

        // Read index.html
        const indexPath = path.join(__dirname, 'index.html');
        let html = await fs.readFile(indexPath, 'utf-8');

        // Create the album entry (new shelf format)
        const albumEntry = `                    <a class="album-cover" href="#" data-bandcamp="${bandcampUrl}">
                        <img class="album-artwork" src="${webpFilename}" alt="${artist} - ${album}" loading="lazy">
                        <div class="album-info">
                            <div class="artist">${artist}</div>
                            <div class="album">${album}</div>
                        </div>
                    </a>`;

        // Find the genre section
        const sectionRegex = new RegExp(`<!-- ${genreName} Section -->([\\s\\S]*?)(?=<!-- \\w|<script)`, '');
        const sectionMatch = html.match(sectionRegex);

        if (!sectionMatch) {
            return res.status(400).json({ error: `Could not find genre section: ${genreName}` });
        }

        // Find all albums containers for this genre
        const albumsPattern = new RegExp(`<div class="albums" data-genre="${genreClass}">`, 'g');
        const matches = [...html.matchAll(albumsPattern)];

        if (matches.length === 0) {
            return res.status(400).json({ error: `Could not find any albums containers for ${genreName}` });
        }

        // Get the position of the last albums container for this genre
        const lastMatch = matches[matches.length - 1];
        const lastAlbumsStart = lastMatch.index;

        // Find the end of this albums container (first </div> after the albums start)
        let searchPos = lastAlbumsStart + lastMatch[0].length;
        let depth = 1;
        let lastAlbumsEnd = -1;

        while (depth > 0 && searchPos < html.length) {
            const nextOpen = html.indexOf('<div', searchPos);
            const nextClose = html.indexOf('</div>', searchPos);

            if (nextClose === -1) break;

            if (nextOpen !== -1 && nextOpen < nextClose) {
                depth++;
                searchPos = nextOpen + 4;
            } else {
                depth--;
                if (depth === 0) {
                    lastAlbumsEnd = nextClose;
                }
                searchPos = nextClose + 6;
            }
        }

        if (lastAlbumsEnd === -1) {
            return res.status(500).json({ error: 'Could not parse albums container structure' });
        }

        const albumsContent = html.substring(lastAlbumsStart, lastAlbumsEnd);

        // Count albums in this container
        const albumCount = (albumsContent.match(/class="album-cover"/g) || []).length;

        if (albumCount >= 4) {
            // Create a new shelf - find the shelf end (next closing div after albums end)
            const shelfEnd = html.indexOf('</div>', lastAlbumsEnd + 6);
            const newShelf = `
            <div class="shelf">
                <div class="albums" data-genre="${genreClass}">
${albumEntry}
                </div>
            </div>`;
            html = html.slice(0, shelfEnd + 6) + newShelf + html.slice(shelfEnd + 6);
        } else {
            // Add to existing albums container - insert before the closing </div>
            html = html.slice(0, lastAlbumsEnd) + '\n' + albumEntry + '\n                ' + html.slice(lastAlbumsEnd);
        }

        // Write the updated HTML back
        await fs.writeFile(indexPath, html, 'utf-8');

        res.json({ 
            success: true, 
            message: `Added ${artist} - ${album} to ${genre} section` 
        });

    } catch (error) {
        console.error('Add album error:', error);
        res.status(500).json({ error: 'Failed to add album to index.html' });
    }
});

// API endpoint to list all albums
app.get('/api/list-albums', async (req, res) => {
    try {
        const indexPath = path.join(__dirname, 'index.html');
        const html = await fs.readFile(indexPath, 'utf-8');

        const genres = ['metal', 'stoner-psych', 'prog', 'rock-pop', 'alternative', 'archival'];
        const albums = {};

        genres.forEach(genre => {
            albums[genre] = [];

            // Find all <div class="albums" data-genre="${genre}"> containers
            const containerRegex = new RegExp(`<div class="albums" data-genre="${genre}">`, 'g');
            let containerMatch;
            let containerCount = 0;

            while ((containerMatch = containerRegex.exec(html)) !== null) {
                containerCount++;
                const containerStart = containerMatch.index + containerMatch[0].length;

                // Find the closing </div> using depth tracking
                let depth = 1;
                let pos = containerStart;
                while (depth > 0 && pos < html.length) {
                    if (html.substring(pos, pos + 5) === '<div ' || html.substring(pos, pos + 5) === '<div>') {
                        depth++;
                    } else if (html.substring(pos, pos + 6) === '</div>') {
                        depth--;
                    }
                    if (depth === 0) break;
                    pos++;
                }

                const containerContent = html.substring(containerStart, pos);
                console.log(`Genre ${genre}, container ${containerCount}: content length = ${containerContent.length}`);

                // Split by album-cover anchor tags to get each album
                const albumParts = containerContent.split('<a class="album-cover"');
                console.log(`  Split into ${albumParts.length} parts`);
                let albumsInContainer = 0;

                // Skip first part (it's before the first album)
                for (let i = 1; i < albumParts.length; i++) {
                    const albumHTML = '<a class="album-cover"' + albumParts[i];

                    // Extract album data
                    const bandcampMatch = albumHTML.match(/data-bandcamp="([^"]*)"/);
                    const srcMatch = albumHTML.match(/src="([^"]*)"/);
                    const artistMatch = albumHTML.match(/<div class="artist">([^<]*)<\/div>/);
                    const albumTitleMatch = albumHTML.match(/<div class="album">([^<]*)<\/div>/);

                    if (bandcampMatch && srcMatch && artistMatch && albumTitleMatch) {
                        albumsInContainer++;
                        albums[genre].push({
                            bandcampUrl: bandcampMatch[1],
                            artwork: srcMatch[1],
                            artist: artistMatch[1],
                            album: albumTitleMatch[1]
                        });
                    }
                }
                console.log(`  Found ${albumsInContainer} albums in this container`);
            }
            console.log(`Total for ${genre}: ${albums[genre].length} albums from ${containerCount} containers`);
        });

        res.json({ albums });

    } catch (error) {
        console.error('List albums error:', error);
        res.status(500).json({ error: 'Failed to list albums' });
    }
});

// API endpoint to edit album
app.put('/api/edit-album', async (req, res) => {
    try {
        const { artist, album, bandcampUrl, currentGenre, newGenre, index } = req.body;
        const indexPath = path.join(__dirname, 'index.html');
        let html = await fs.readFile(indexPath, 'utf-8');

        // Find all albums in the current genre using the SAME method as list endpoint
        const containerRegex = new RegExp(`<div class="albums" data-genre="${currentGenre}">`, 'g');
        let containerMatch;
        let allMatches = [];

        while ((containerMatch = containerRegex.exec(html)) !== null) {
            const containerStart = containerMatch.index + containerMatch[0].length;

            // Find the closing </div> using depth tracking
            let depth = 1;
            let pos = containerStart;
            while (depth > 0 && pos < html.length) {
                if (html.substring(pos, pos + 5) === '<div ' || html.substring(pos, pos + 5) === '<div>') {
                    depth++;
                } else if (html.substring(pos, pos + 6) === '</div>') {
                    depth--;
                }
                if (depth === 0) break;
                pos++;
            }

            const containerContent = html.substring(containerStart, pos);

            // Split by album-cover anchor tags to get each album
            const albumParts = containerContent.split('<a class="album-cover"');

            // Skip first part (it's before the first album)
            for (let i = 1; i < albumParts.length; i++) {
                const albumHTML = '<a class="album-cover"' + albumParts[i];

                // Find where this album starts in the full HTML
                const albumStart = containerMatch.index + containerMatch[0].length + containerContent.indexOf('<a class="album-cover"' + albumParts[i]);

                // Find the end of the album (find the closing </a>)
                let albumEndSearch = albumStart;
                let aDepth = 1;
                while (aDepth > 0 && albumEndSearch < html.length) {
                    if (html.substring(albumEndSearch, albumEndSearch + 2) === '<a') {
                        aDepth++;
                    } else if (html.substring(albumEndSearch, albumEndSearch + 4) === '</a>') {
                        aDepth--;
                        if (aDepth === 0) {
                            albumEndSearch += 4;
                            break;
                        }
                    }
                    albumEndSearch++;
                }

                allMatches.push({
                    fullMatch: html.substring(albumStart, albumEndSearch),
                    position: albumStart,
                    length: albumEndSearch - albumStart
                });
            }
        }

        if (index >= allMatches.length) {
            return res.status(404).json({ error: 'Album not found at specified index' });
        }

        const targetAlbum = allMatches[index];
        const oldAlbumHTML = targetAlbum.fullMatch;

        // Create updated album HTML
        const artistMatch = oldAlbumHTML.match(/<div class="artist">([^<]*)<\/div>/);
        const albumMatch = oldAlbumHTML.match(/<div class="album">([^<]*)<\/div>/);
        const artworkMatch = oldAlbumHTML.match(/src="([^"]*)"/);

        if (!artistMatch || !albumMatch || !artworkMatch) {
            return res.status(400).json({ error: 'Could not parse album HTML' });
        }

        let newAlbumHTML = oldAlbumHTML.replace(artistMatch[1], artist);
        newAlbumHTML = newAlbumHTML.replace(albumMatch[1], album);
        newAlbumHTML = newAlbumHTML.replace(/data-bandcamp="[^"]*"/, `data-bandcamp="${bandcampUrl}"`);
        newAlbumHTML = newAlbumHTML.replace(/alt="[^"]*"/, `alt="${artist} - ${album}"`);

        // If moving to a different genre, remove from current and add to new
        if (newGenre && newGenre !== currentGenre) {
            // Remove from current genre
            html = html.slice(0, targetAlbum.position) + html.slice(targetAlbum.position + targetAlbum.length);

            // Add to new genre (at the end of last shelf)
            const newGenreRegex = new RegExp(`<div class="albums" data-genre="${newGenre}">`, 'g');
            const newGenreMatches = [...html.matchAll(newGenreRegex)];

            if (newGenreMatches.length === 0) {
                return res.status(404).json({ error: `Genre ${newGenre} not found` });
            }

            const lastMatch = newGenreMatches[newGenreMatches.length - 1];
            let searchPos = lastMatch.index + lastMatch[0].length;
            let depth = 1;
            let lastAlbumsEnd = -1;

            while (depth > 0 && searchPos < html.length) {
                const nextOpen = html.indexOf('<div', searchPos);
                const nextClose = html.indexOf('</div>', searchPos);

                if (nextClose === -1) break;

                if (nextOpen !== -1 && nextOpen < nextClose) {
                    depth++;
                    searchPos = nextOpen + 4;
                } else {
                    depth--;
                    if (depth === 0) {
                        lastAlbumsEnd = nextClose;
                    }
                    searchPos = nextClose + 6;
                }
            }

            // Update data-genre attribute in the album HTML
            newAlbumHTML = newAlbumHTML.replace(/data-genre="[^"]*"/, `data-genre="${newGenre}"`);

            html = html.slice(0, lastAlbumsEnd) + '\n                    ' + newAlbumHTML + '\n                ' + html.slice(lastAlbumsEnd);
        } else {
            // Just update in place
            html = html.slice(0, targetAlbum.position) + newAlbumHTML + html.slice(targetAlbum.position + targetAlbum.length);
        }

        await fs.writeFile(indexPath, html, 'utf-8');

        res.json({
            success: true,
            message: `Updated ${artist} - ${album}`
        });

    } catch (error) {
        console.error('Edit album error:', error);
        res.status(500).json({ error: 'Failed to edit album' });
    }
});

// API endpoint to delete album
app.delete('/api/delete-album', async (req, res) => {
    try {
        const { genre, index } = req.body;
        const indexPath = path.join(__dirname, 'index.html');
        let html = await fs.readFile(indexPath, 'utf-8');

        // Find all albums in the genre
        const genreRegex = new RegExp(`(<div class="albums" data-genre="${genre}">)([\\s\\S]*?)(</div>\\s*</div>)`, 'g');
        const albumRegex = /<a class="album-cover"[\s\S]*?<\/a>/g;

        let genreMatch;
        let allMatches = [];

        while ((genreMatch = genreRegex.exec(html)) !== null) {
            let albumMatch;
            let startPos = genreMatch.index + genreMatch[1].length;
            let albumsHTML = genreMatch[2];

            while ((albumMatch = albumRegex.exec(albumsHTML)) !== null) {
                allMatches.push({
                    fullMatch: albumMatch[0],
                    position: startPos + albumMatch.index,
                    length: albumMatch[0].length
                });
            }
        }

        if (index >= allMatches.length) {
            return res.status(404).json({ error: 'Album not found at specified index' });
        }

        const targetAlbum = allMatches[index];

        // Extract artist and album name for response message
        const artistMatch = targetAlbum.fullMatch.match(/<div class="artist">([^<]*)<\/div>/);
        const albumMatch = targetAlbum.fullMatch.match(/<div class="album">([^<]*)<\/div>/);

        const artistName = artistMatch ? artistMatch[1] : 'Unknown';
        const albumName = albumMatch ? albumMatch[1] : 'Unknown';

        // Remove the album HTML
        html = html.slice(0, targetAlbum.position) + html.slice(targetAlbum.position + targetAlbum.length);

        await fs.writeFile(indexPath, html, 'utf-8');

        res.json({
            success: true,
            message: `Deleted ${artistName} - ${albumName}`
        });

    } catch (error) {
        console.error('Delete album error:', error);
        res.status(500).json({ error: 'Failed to delete album' });
    }
});

app.listen(PORT, () => {
    console.log(`Admin server running at http://localhost:${PORT}`);
    console.log(`Visit http://localhost:${PORT}/admin to add albums`);
});
