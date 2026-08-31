import type { Context, Config } from "@netlify/functions";
import neo4j from "neo4j-driver";

const NEW_SERVER_NAME = "APP-SRV-04";
const HOST_APP_NAME = "Notification Service";

export default async (req: Request, context: Context) => {
  const uri = Netlify.env.get("NEO4J_URI");
  const username = Netlify.env.get("NEO4J_USERNAME");
  const password = Netlify.env.get("NEO4J_PASSWORD");

  if (!uri || !username || !password) {
    return new Response(JSON.stringify({ error: "Missing Neo4j credentials" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }

  const driver = neo4j.driver(uri, neo4j.auth.basic(username, password));
  const session = driver.session();

  try {
    const checkResult = await session.run(
      `MATCH (s:Server {name: $name}) RETURN s`,
      { name: NEW_SERVER_NAME }
    );

    if (checkResult.records.length > 0) {
      const existing = checkResult.records[0].get("s");
      const nodeId = existing.identity.toString();

      await session.run(
        `MATCH (s:Server {name: $name}) DETACH DELETE s`,
        { name: NEW_SERVER_NAME }
      );

      return new Response(JSON.stringify({
        action: "removed",
        nodeId
      }), { headers: { "Content-Type": "application/json" } });
    }

    const createResult = await session.run(
      `MATCH (app:Application {name: $hostName})
       CREATE (s:Server {name: $serverName})
       MERGE (app)-[r:depends_on]->(s)
       RETURN s, r, app`,
      { hostName: HOST_APP_NAME, serverName: NEW_SERVER_NAME }
    );

    const record = createResult.records[0];
    const s = record.get("s");
    const r = record.get("r");
    const app = record.get("app");

    return new Response(JSON.stringify({
      action: "added",
      node: {
        id: s.identity.toString(),
        label: s.properties.name,
        group: s.labels[0]
      },
      edge: {
        id: r.identity.toString(),
        from: app.identity.toString(),
        to: s.identity.toString(),
        label: r.type
      }
    }), { headers: { "Content-Type": "application/json" } });
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
  path: "/api/discover-asset"
};
