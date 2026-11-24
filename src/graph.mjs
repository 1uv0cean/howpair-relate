import { Database } from '@relate/relate';

export function createGraph(path, scenes, links) {
  const byId = new Map(scenes.map(scene => [scene.id, scene]));
  if (byId.size !== scenes.length) throw new Error('Scene IDs must be unique.');

  for (const { from, to } of links) {
    const start = byId.get(from);
    const end = byId.get(to);
    if (!start || !end || start.couple !== end.couple || start.date > end.date || from === to) {
      throw new Error('Links must connect different scenes in date order within the same couple.');
    }
  }

  const db = Database.open(path);
  const connection = db.connect();
  connection.query('CREATE CONSTRAINT scene_id IF NOT EXISTS FOR (s:Scene) REQUIRE s.id IS UNIQUE');
  connection.query('CREATE CONSTRAINT couple_id IF NOT EXISTS FOR (c:Couple) REQUIRE c.id IS UNIQUE');
  for (const { id, couple, date, lines } of scenes) {
    connection.query(
      `MERGE (c:Couple {id: $couple})
       CREATE (c)-[:HAS_SCENE]->(:Scene {id: $id, couple: $couple, date: $date, transcript: $transcript})`,
      { id, couple, date, transcript: lines.map(([speaker, text]) => `${speaker}: ${text}`).join('\n') },
    );
  }
  for (const link of links) {
    connection.query(
      `MATCH (a:Scene {id: $from}), (b:Scene {id: $to})
       CREATE (a)-[:CONTINUED_IN {label: $label}]->(b)`,
      link,
    );
  }
  if (path !== ':memory:') db.checkpoint();
  return connection;
}

export function openGraph(path) {
  return Database.open(path, { readOnly: true }).connect();
}

export function expandTrail(connection, couple, seed, from = '', through = '9999-12-31') {
  const result = connection.query(
    `MATCH p = (start:Scene {id: $seed})-[:CONTINUED_IN*1..2]-(scene:Scene)
     WHERE scene.id <> $seed AND ALL(s IN nodes(p) WHERE
       s.couple = $couple AND s.date >= $from AND s.date <= $through)
     RETURN scene.id AS id, [s IN nodes(p) | s.id] AS path,
       [r IN relationships(p) | r.label] AS reasons
     ORDER BY length(p), scene.date, scene.id`,
    { couple, seed, from, through },
  );
  return result.rows;
}
