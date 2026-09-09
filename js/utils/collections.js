export function shuffleItems(items, random = Math.random) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

export function shuffleSentenceTokens(tokens, answer, random = Math.random) {
  const result = shuffleItems(tokens, random);
  const normalize = text => String(text).toLocaleLowerCase('lt-LT').match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)?.join(' ') || '';
  // Randomness can return the answer order. Swap two distinct tiles in that case.
  if (normalize(result.join(' ')) === normalize(answer)) {
    const different = result.findIndex(token => normalize(token) !== normalize(result[0]));
    if (different > 0) [result[0], result[different]] = [result[different], result[0]];
  }
  return result;
}
