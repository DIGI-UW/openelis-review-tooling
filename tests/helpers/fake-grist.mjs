// A stand-in for Grist, faithful about the parts that have actually bitten.
//
// The sync tool is the layer nothing exercised, and every bug found in it was
// about order of operations or a call site rather than about Grist itself. So
// this serves the subset of the API the tool uses, over real HTTP, against an
// in-memory document — and the tool runs unmodified against it, CLI and all.
//
// Where the real API refuses something, this refuses it too. Those rules are not
// guesses; each one is a 4xx this project has already hit in production:
//   - PATCH /columns requires every record in the request to carry the same
//     fields, so a plan of mixed drifts has to be split.
//   - A Ref column filters by row id, not by the text somebody typed.
//   - A removed column stops appearing, so anything still reading it gets
//     nothing rather than the old value.

import { createServer } from "node:http";

export function fakeGristDoc(seed = {}) {
  return {
    id: "docFAKE",
    name: "UAT Checklists",
    access: seed.access || "owners",
    directAccess: seed.directAccess || seed.access || "owners",
    activationForbidden: Boolean(seed.activationForbidden),
    activation: structuredClone(
      seed.activation || {
        installationId: "installation-FAKE",
        planName: "trial",
        keyPrefix: null,
        trial: {
          days: 30,
          expirationDate: "2099-01-31T00:00:00.000Z",
          daysLeft: 30,
        },
        needKey: false,
      },
    ),
    tables: structuredClone(seed.tables || {}),
    // Every request the tool made, in order, so a test can assert on sequence
    // rather than only on the state left behind.
    calls: [],
    // Pages the document already had, so a test can put something in the way of
    // anything that removes pages.
    views: structuredClone(seed.views || []),
    // Table ids whose writes should fail, so a test can interrupt a service
    // half way through a multi-table write.
    failWrites: new Set(seed.failWrites || []),
  };
}

function tableOf(doc, id) {
  if (!doc.tables[id]) doc.tables[id] = { columns: [], records: [] };
  return doc.tables[id];
}

function nextId(table) {
  return table.records.reduce((max, record) => Math.max(max, record.id), 0) + 1;
}

// _grist_Tables and _grist_Tables_column are how the tool discovers row ids for
// tables and columns when it builds pages.
function metaTables(doc) {
  const ids = Object.keys(doc.tables).filter((id) => !id.startsWith("_grist_"));
  return ids.map((tableId, index) => ({ id: index + 1, fields: { tableId } }));
}
function metaColumns(doc) {
  const out = [];
  let id = 1;
  metaTables(doc).forEach((table) => {
    for (const column of tableOf(doc, table.fields.tableId).columns) {
      out.push({ id: id++, fields: { colId: column.id, parentId: table.id } });
    }
  });
  return out;
}

function applyUserActions(doc, actions) {
  const retValues = [];
  for (const action of actions) {
    const [name, ...args] = action;
    if (name === "RemoveColumn") {
      const [tableId, colId] = args;
      const table = tableOf(doc, tableId);
      table.columns = table.columns.filter((column) => column.id !== colId);
      // A removed column is gone from the rows too — which is the whole hazard:
      // anything that still needed it now reads undefined.
      for (const record of table.records) delete record.fields[colId];
      retValues.push(null);
    } else if (name === "RemoveView") {
      doc.views = (doc.views || []).filter((view) => view.id !== args[0]);
      retValues.push(null);
    } else if (name === "CreateViewSection") {
      const [tableRef, viewRef] = args;
      doc.views = doc.views || [];
      doc.sections = doc.sections || [];
      let view = doc.views.find((candidate) => candidate.id === viewRef);
      if (!view) {
        view = { id: doc.views.length + 3, fields: { name: "", type: "" } };
        doc.views.push(view);
      }
      const section = {
        id: doc.sections.length + 20,
        viewRef: view.id,
        tableRef,
        fields: {},
      };
      doc.sections.push(section);
      retValues.push({ viewRef: view.id, sectionRef: section.id });
    } else if (name === "BulkRemoveRecord" || name === "RemoveRecord") {
      const [tableId, rows] = args;
      const ids = new Set(Array.isArray(rows) ? rows : [rows]);
      const table = tableOf(doc, tableId);
      table.records = table.records.filter((record) => !ids.has(record.id));
      retValues.push(null);
    } else if (name === "UpdateRecord") {
      const [tableId, rowId, fields] = args;
      if (tableId === "_grist_Views") {
        const view = (doc.views || []).find(
          (candidate) => candidate.id === rowId,
        );
        if (view) Object.assign(view.fields, fields);
      } else if (tableId === "_grist_Views_section") {
        const section = (doc.sections || []).find(
          (candidate) => candidate.id === rowId,
        );
        if (section) Object.assign(section.fields, fields);
      }
      retValues.push(null);
    } else {
      retValues.push(null);
    }
  }
  return { retValues };
}

export async function startFakeGrist(doc) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const path = url.pathname;
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const send = (status, payload) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      const parsed = body ? JSON.parse(body) : null;
      doc.calls.push(`${req.method} ${path}`);

      if (path.endsWith("/workspaces")) {
        return send(200, [{ id: 1, docs: [{ id: doc.id, name: doc.name }] }]);
      }

      if (path === "/api/profile/user" && req.method === "GET") {
        return send(200, { id: 5, email: "admin@example.test" });
      }

      if (path === "/api/orgs/openelis" && req.method === "GET") {
        return send(200, {
          billingAccount: {
            inGoodStanding: true,
            product: { name: "team", features: { readOnlyDocs: false } },
          },
        });
      }

      if (path === "/api/activation/status" && req.method === "GET") {
        if (doc.activationForbidden) return send(403, { error: "Access denied" });
        return send(200, doc.activation);
      }

      if (path === `/api/docs/${doc.id}` && req.method === "GET") {
        return send(200, { id: doc.id, name: doc.name, access: doc.access });
      }

      if (path === `/api/docs/${doc.id}/access` && req.method === "GET") {
        return send(200, {
          maxInheritedRole: "owners",
          users: [
            {
              email: "admin@example.test",
              id: 5,
              access: doc.directAccess,
              parentAccess: "owners",
            },
          ],
        });
      }

      const tablesRoot = `/api/docs/${doc.id}/tables`;
      if (path === tablesRoot && req.method === "GET") {
        return send(200, {
          tables: metaTables(doc).map((t) => ({ id: t.fields.tableId })),
        });
      }
      if (path === tablesRoot && req.method === "POST") {
        for (const spec of parsed.tables) {
          doc.tables[spec.id] = {
            columns: spec.columns.map((column) => ({
              id: column.id,
              fields: column.fields,
            })),
            records: [],
          };
          // Grist gives a new table a primary view, and that view is a page in
          // the left-hand nav. Modelling it is the only way a test can see the
          // raw table dumps a create leaves behind beside the authored pages.
          doc.views = doc.views || [];
          doc.views.push({
            id: doc.views.length + 3,
            fields: { name: spec.id, type: "raw_data" },
          });
        }
        return send(200, {});
      }

      const columns = path.match(new RegExp(`^${tablesRoot}/([^/]+)/columns$`));
      if (columns) {
        const table = tableOf(doc, columns[1]);
        if (req.method === "GET") return send(200, { columns: table.columns });
        if (req.method === "POST") {
          table.columns.push(
            ...parsed.columns.map((c) => ({ id: c.id, fields: c.fields })),
          );
          return send(200, {});
        }
        if (req.method === "PATCH") {
          // The real constraint, and a real 400 this project hit in production.
          const shapes = new Set(
            parsed.columns.map((c) => Object.keys(c.fields).sort().join(",")),
          );
          if (shapes.size > 1) {
            return send(400, {
              error: "PATCH requires all records to have same fields",
            });
          }
          for (const patch of parsed.columns) {
            const column = table.columns.find(
              (candidate) => candidate.id === patch.id,
            );
            if (column) Object.assign(column.fields, patch.fields);
          }
          return send(200, {});
        }
      }

      const records = path.match(new RegExp(`^${tablesRoot}/([^/]+)/records$`));
      if (records) {
        const id = records[1];
        if (id === "_grist_Tables")
          return send(200, { records: metaTables(doc) });
        if (id === "_grist_Tables_column")
          return send(200, { records: metaColumns(doc) });
        if (id === "_grist_Views")
          return send(200, { records: doc.views || [] });
        const table = tableOf(doc, id);
        if (req.method === "GET") {
          const filter = url.searchParams.get("filter");
          let rows = table.records;
          if (filter) {
            const want = JSON.parse(filter);
            rows = rows.filter((record) =>
              Object.entries(want).every(([field, values]) =>
                // Strict, like the real thing: a Ref column holds a row id, so
                // filtering it by the slug somebody typed matches nothing.
                values.some((value) => record.fields[field] === value),
              ),
            );
          }
          return send(200, { records: rows });
        }
        if (req.method === "POST") {
          if (doc.failWrites.has(id)) {
            return send(500, { error: `writes to ${id} are failing` });
          }
          const created = parsed.records.map((record) => {
            const row = { id: nextId(table), fields: { ...record.fields } };
            table.records.push(row);
            return { id: row.id };
          });
          return send(200, { records: created });
        }
        if (req.method === "PATCH") {
          for (const patch of parsed.records) {
            const row = table.records.find(
              (candidate) => candidate.id === patch.id,
            );
            if (row) Object.assign(row.fields, patch.fields);
          }
          return send(200, {});
        }
      }

      if (path === `/api/docs/${doc.id}/apply` && req.method === "POST") {
        // Named in the call log, because /apply carries every user action there
        // is: a test asserting on order needs to know which one this was, not
        // merely that something was applied.
        doc.calls[doc.calls.length - 1] =
          `POST ${path} ${parsed.map((action) => action[0]).join(",")}`;
        return send(200, applyUserActions(doc, parsed));
      }

      return send(404, {
        error: `fake grist has no route for ${req.method} ${path}`,
      });
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    stop: () => new Promise((resolve) => server.close(resolve)),
  };
}
