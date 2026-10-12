/* Searches Wikimedia Commons (File namespace) and prints candidates with licence metadata as JSON lines.
   node tools/media/commons.js "romanian deadlift" video 20 */
'use strict';
const [query, kind = 'video', limit = '20'] = process.argv.slice(2);
if (!query) { console.error('usage: commons.js "<query>" [video|image] [limit]'); process.exit(2); }
const API = 'https://commons.wikimedia.org/w/api.php';
const strip = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
(async () => {
  const params = new URLSearchParams({
    action: 'query', format: 'json', generator: 'search', gsrnamespace: '6', gsrlimit: String(limit),
    gsrsearch: query + (kind === 'video' ? ' filetype:video' : ' filetype:bitmap'),
    prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata|mediatype', iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist',
  });
  const r = await fetch(API + '?' + params, { headers: { 'User-Agent': 'GymQuest-media-sourcing/1.0 (https://surotvsk.github.io/Gymquest/)' } });
  const data = await r.json();
  const pages = Object.values((data.query && data.query.pages) || {});
  for (const pg of pages) {
    const ii = (pg.imageinfo || [])[0] || {};
    const md = ii.extmetadata || {};
    console.log(JSON.stringify({
      title: pg.title, url: ii.url, page: 'https://commons.wikimedia.org/wiki/' + encodeURIComponent(pg.title.replace(/ /g, '_')).replace(/^File%3A/, 'File:'),
      mime: ii.mime, width: ii.width, height: ii.height, duration: ii.duration || null, size: ii.size,
      license: md.LicenseShortName ? md.LicenseShortName.value : null, licenseUrl: md.LicenseUrl ? md.LicenseUrl.value : null,
      artist: md.Artist ? strip(md.Artist.value) : null,
    }));
  }
  if (!pages.length) console.error('no results');
})().catch((e) => { console.error(e.message); process.exit(1); });
