/* Shared manuscript renderer for owner preview and the public reader. */
(function() {
  'use strict';
  function render(body, comment, snapshot, onParagraph) {
    const text = String(snapshot?.content ?? '').replace(/\r\n?/g, '\n');
    const version = String(snapshot?.version ?? '');
    const fragment = document.createDocumentFragment();
    text.split('\n\n').forEach((part, index) => {
      const paragraph = document.createElement('p');
      paragraph.className = 'reader-paragraph';
      paragraph.dataset.paragraphIndex = String(index);
      paragraph.style.whiteSpace = 'pre-wrap';
      if (part) paragraph.textContent = part;
      else paragraph.append(document.createElement('br'));
      if (onParagraph) paragraph.addEventListener('click', () => onParagraph(index, part, version));
      fragment.append(paragraph);
    });
    body.replaceChildren(fragment);
    if (comment) {
      comment.replaceChildren();
      const strong = document.createElement('strong');
      strong.textContent = '작가의 말: ';
      comment.append(strong, document.createTextNode(String(snapshot?.authorComment ?? '')));
    }
  }
  window.ReaderContent = Object.freeze({render});
})();
