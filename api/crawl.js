name: Auto Crawl PLN Papua

on:
  schedule:
    - cron: '0 0,6,12,18 * * *'  # Setiap 6 jam
  workflow_dispatch:

jobs:
  crawl:
    runs-on: ubuntu-latest
    steps:
      - name: Crawl All Batches
        run: |
          SECRET="${{ secrets.CRON_SECRET }}"
          BASE="https://pln-news-monitor.vercel.app/api/crawl"
          TOTAL_FEEDS=592
          BATCH_SIZE=30
          TOTAL_BATCHES=$(( (TOTAL_FEEDS + BATCH_SIZE - 1) / BATCH_SIZE ))
          
          echo "Total batches: $TOTAL_BATCHES"
          
          for i in $(seq 0 $((TOTAL_BATCHES - 1))); do
            echo "Crawling batch $i..."
            RESULT=$(curl -s "${BASE}?secret=${SECRET}&keyword=PLN+Papua&batchIndex=${i}&batch=${BATCH_SIZE}")
            echo "Batch $i: $RESULT"
            sleep 3
          done
          
          echo "All batches done!"

      - name: Analyze New Articles
        run: |
          SECRET="${{ secrets.CRON_SECRET }}"
          echo "Running analyze batch..."
          for i in 1 2 3 4 5; do
            curl -s "https://pln-news-monitor.vercel.app/api/analyze-batch?secret=${SECRET}&batch=30"
            sleep 5
          done
          echo "Analyze done!"
