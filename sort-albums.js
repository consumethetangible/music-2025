const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');

// Helper function to get sortable artist name (strips "The " from beginning)
function getSortKey(artistName) {
    return artistName.replace(/^The\s+/i, '').trim();
}

// Define sections to process
const sections = [
    { name: 'Metal', dataGenre: 'metal' },
    { name: 'Stoner & Psych', dataGenre: 'stoner-psych' },
    { name: 'Prog', dataGenre: 'prog' },
    { name: 'Rock & Pop', dataGenre: 'rock-pop' },
    { name: 'Alternative', dataGenre: 'alternative' }
];

sections.forEach(section => {
    console.log(`\nProcessing ${section.name}...`);

    // Find the section
    const sectionRegex = new RegExp(`(<!-- ${section.name} Section -->\\s*<div class="section">\\s*<h2>${section.name}</h2>)([\\s\\S]*?)(</div>\\s*(?=<!-- \\w|<script))`, '');
    const sectionMatch = html.match(sectionRegex);

    if (!sectionMatch) {
        console.log(`  ✗ Section not found`);
        return;
    }

    const sectionStart = sectionMatch[1];
    const sectionContent = sectionMatch[2];
    const sectionEnd = sectionMatch[3];

    // Extract all albums
    const albumRegex = /<a class="album-cover"[\s\S]*?<\/a>/g;
    const albums = [];
    let match;
    while ((match = albumRegex.exec(sectionContent)) !== null) {
        const albumHTML = match[0];
        // Extract artist name
        const artistMatch = albumHTML.match(/<div class="artist">(.*?)<\/div>/);
        if (artistMatch) {
            albums.push({
                html: albumHTML,
                artist: artistMatch[1].trim()
            });
        }
    }

    console.log(`  Found ${albums.length} albums`);

    if (albums.length === 0) return;

    // Sort alphabetically by artist (ignoring "The" at the start)
    albums.sort((a, b) => getSortKey(a.artist).localeCompare(getSortKey(b.artist)));

    console.log(`  Sorted order: ${albums.map(a => a.artist).join(', ')}`);

    // Rebuild shelves with max 4 albums per shelf
    let newShelvesHTML = '\n';
    for (let i = 0; i < albums.length; i += 4) {
        const shelfAlbums = albums.slice(i, i + 4);
        newShelvesHTML += `            <div class="shelf">\n`;
        newShelvesHTML += `                <div class="albums" data-genre="${section.dataGenre}">\n`;
        shelfAlbums.forEach(album => {
            newShelvesHTML += `                    ${album.html}\n`;
        });
        newShelvesHTML += `                </div>\n`;
        newShelvesHTML += `            </div>\n`;
    }
    newShelvesHTML += '        ';

    // Replace the section content
    const newSection = sectionStart + newShelvesHTML + sectionEnd;
    html = html.replace(sectionMatch[0], newSection);

    console.log(`  ✓ ${section.name} sorted and restructured`);
});

// Write the updated HTML
fs.writeFileSync(htmlPath, html);
console.log('\n✓ All sections sorted alphabetically by artist!');
