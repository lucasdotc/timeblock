export interface Laid {
  col: number; // column index within the overlap cluster
  cols: number; // total columns in that cluster
}

/**
 * Assign side-by-side columns to overlapping blocks (Google-Calendar style):
 * sweep by start time, reuse a column once its last block has ended, and give
 * every block in a contiguous overlap cluster the same column count so they
 * share the available width evenly. Returns a map of block id → {col, cols}.
 */
export function packColumns(items: { id: string; startMin: number; endMin: number }[]): Map<string, Laid> {
  const evs = [...items].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const res = new Map<string, Laid>();
  let cluster: { id: string; col: number }[] = [];
  let clusterEnd = -Infinity;
  const colEnd: number[] = []; // end minute of the last block in each column

  const flush = () => {
    for (const c of cluster) res.set(c.id, { col: c.col, cols: colEnd.length });
    cluster = [];
    colEnd.length = 0;
  };

  for (const ev of evs) {
    if (ev.startMin >= clusterEnd) flush();
    let col = -1;
    for (let c = 0; c < colEnd.length; c++) {
      if (colEnd[c] <= ev.startMin) {
        col = c;
        colEnd[c] = ev.endMin;
        break;
      }
    }
    if (col === -1) {
      col = colEnd.length;
      colEnd.push(ev.endMin);
    }
    cluster.push({ id: ev.id, col });
    clusterEnd = Math.max(clusterEnd, ev.endMin);
  }
  flush();
  return res;
}
