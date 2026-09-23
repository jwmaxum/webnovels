(function(root) {
  function computeLineDiff(oldText, newText) {
    const oldLines = oldText ? oldText.split('\n') : [];
    const newLines = newText ? newText.split('\n') : [];
    const m = oldLines.length;
    const n = newLines.length;

    // Safety fallback for very large texts to avoid O(M*N) memory spikes
    if (m * n > 250000) {
      return oldLines.map((text,i)=>({type:'del',text,oldNum:i+1})).concat(newLines.map((text,i)=>({type:'ins',text,newNum:i+1})));
    }

    // Dynamic programming matrix for Longest Common Subsequence (LCS)
    const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < n; j++) {
        if (oldLines[i] === newLines[j]) {
          dp[i + 1][j + 1] = dp[i][j] + 1;
        } else {
          dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
      }
    }

    // Backtrack to build diff ops
    const diff = [];
    let i = m;
    let j = n;

    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
        diff.push({ type: 'same', text: oldLines[i - 1], oldNum: i, newNum: j });
        i--;
        j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        diff.push({ type: 'ins', text: newLines[j - 1], oldNum: null, newNum: j });
        j--;
      } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
        diff.push({ type: 'del', text: oldLines[i - 1], oldNum: i, newNum: null });
        i--;
      }
    }

    return diff.reverse();
  }

root.draftLineDiff=computeLineDiff;
})(globalThis);
