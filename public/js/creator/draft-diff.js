(function(root) {
  function computeLineDiff(oldText, newText) {
    const oldLines = oldText ? oldText.split('\n') : [];
    const newLines = newText ? newText.split('\n') : [];
    const m = oldLines.length;
    const n = newLines.length;

    // A preview is bounded; the full snapshots remain available for restore/export.
    if (m * n > 250000 || m + n > 1000 || oldText.length + newText.length > 100000) {
      const sample=(lines,type)=>{
        const indices=lines.length>100
          ? [...Array(50).keys(),...Array.from({length:50},(_,i)=>lines.length-50+i)]
          : lines.map((_,i)=>i);
        const result=[];
        for(const i of indices){
          if(i===lines.length-50 && lines.length>100)
            result.push({type:'summary',text:`${lines.length-100}개 줄 생략 (비교 미리보기 한도)`});
          const text=lines[i];
          result.push({type,text:text.length>2000?text.slice(0,2000)+'… (긴 줄 생략)':text,
            ...(type==='del'?{oldNum:i+1}:{newNum:i+1})});
        }
        return result;
      };
      return sample(oldLines,'del').concat(sample(newLines,'ins'));
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
