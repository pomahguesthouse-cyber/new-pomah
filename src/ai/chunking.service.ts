/**
 * Chunking service for RAG system.
 * Splits long text into smaller segments with optional overlap.
 */

interface ChunkOptions {
  maxLength: number;
  overlap: number;
}

export function chunkText(text: string, options: ChunkOptions = { maxLength: 800, overlap: 100 }): string[] {
  if (!text || text.trim().length === 0) return [];
  
  // Try to split by paragraphs first
  const paragraphs = text.split(/\n\s*\n/);
  const chunks: string[] = [];
  
  let currentChunk = "";
  
  for (const para of paragraphs) {
    const trimmedPara = para.trim();
    if (!trimmedPara) continue;
    
    // If adding this paragraph exceeds maxLength, push current chunk and start new
    if (currentChunk.length + trimmedPara.length > options.maxLength && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      // Start new chunk with overlap from the end of the previous chunk
      const overlapStart = Math.max(0, currentChunk.length - options.overlap);
      // Try to find a good boundary (like a sentence end) for overlap
      const spaceIdx = currentChunk.indexOf(" ", overlapStart);
      const overlapText = spaceIdx !== -1 ? currentChunk.slice(spaceIdx) : currentChunk.slice(-options.overlap);
      
      currentChunk = overlapText.trim() + "\n\n" + trimmedPara;
    } else {
      if (currentChunk.length > 0) {
        currentChunk += "\n\n" + trimmedPara;
      } else {
        currentChunk = trimmedPara;
      }
    }
  }
  
  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }
  
  // If any single chunk is still too large (e.g. one huge paragraph), hard split it
  const finalChunks: string[] = [];
  for (const chunk of chunks) {
    if (chunk.length > options.maxLength * 1.5) {
      let i = 0;
      while (i < chunk.length) {
        finalChunks.push(chunk.slice(i, i + options.maxLength));
        i += (options.maxLength - options.overlap);
      }
    } else {
      finalChunks.push(chunk);
    }
  }
  
  return finalChunks;
}
