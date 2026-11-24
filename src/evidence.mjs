export function evidenceLines(scenes) {
  return scenes.flatMap(scene => scene.lines.map(([by, text], i) => ({
    line: `${scene.id}.${i + 1}`, scene: scene.id, couple: scene.couple, date: scene.date, by, text,
  })));
}
