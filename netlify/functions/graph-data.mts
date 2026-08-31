import type { Context, Config } from "@netlify/functions";
import neo4j from "neo4j-driver";

export default async (req: Request, context: Context) => {
  const uri = Netlify.env.get("NEO4J_URI");
  const username = Netlify.env.get("NEO4J_USERNAME");
  const password = Netlify.env.get("NEO4J_PASSWORD");

  if (!uri || !username || !password) {
    return new Response(JSON.stringify({
      error: "Missing Neo4j credentials in environment variables",
      uriPresent: Boolean(uri),
      usernamePresent: Boolean(username),
      passwordPresent: Boolean(password)
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }

  const driver = neo4j.driver(uri, neo4j.auth.basic(username, password));
  const session = driver.session();

  try {
    const result = await session.run(`
      MATCH (n) WHERE NOT n:DiscoveryRun
      OPTIONAL MATCH (n)-[r]->(m) WHERE NOT m:DiscoveryRun
      RETURN n, r, m
    `);

    const nodesMap = new Map();
    const edges: any[] = [];

    for (const record of result.records) {
      const n = record.get("n");
      const m = record.get("m");
      const r = record.get("r");

      if (n) {
        nodesMap.set(n.identity.toString(), {
          id: n.identity.toString(),
          label: n.properties.name,
          group: n.labels[0]
        });
      }
      if (m) {
        nodesMap.set(m.identity.toString(), {
          id: m.identity.toString(),
          label: m.properties.name,
          group: m.labels[0]
        });
      }
      if (r) {
        edges.push({
          id: r.identity.toString(),
          from: r.start.toString(),
          to: r.end.toString(),
          label: r.type
        });
      }
    }

    return new Response(JSON.stringify({
      nodes: Array.from(nodesMap.values()),
      edges
    }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  } finally {
    await session.close();
    await driver.close();
  }
};

export const config: Config = {
  path: "/api/graph-data"
};
