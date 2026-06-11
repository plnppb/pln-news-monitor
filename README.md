# PLN News Monitor
Media monitoring dashboard untuk PLN UIW Papua & Papua Barat.

## Setup di Vercel

### 1. Environment Variables
Di Vercel dashboard → Settings → Environment Variables, tambahkan:
- `NEWS_API_KEY` → API key dari newsapi.org
- `GEMINI_API_KEY` → API key dari Google AI Studio

### 2. Deploy
Push repo ini ke GitHub, lalu connect ke Vercel.

## Fitur
- Pencarian berita dari NewsAPI + Google News RSS
- AI sentiment analysis (positif/negatif/netral) via Gemini
- AI summary per artikel
- Daily brief otomatis
- Bookmark artikel penting
- Export CSV
- Filter by sentimen & sumber
