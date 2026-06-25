/**
 * api/_notion-sync.js
 * ---------------------------------------------------------------------------
 * Orchestrates outbound sync: whenever an admin saves a client, milestone,
 * session, or resource via the Control Panel, this keeps the matching
 * Notion page in sync. Separated from api/_notion.js (which only knows how
 * to talk to Notion's API) and api/clients.js (which only knows about HTTP
 * request/response) — this module is the layer that knows the actual sync
 * RULES: when to create vs. update, how to handle the client-dependency
 * chain, and what to do when Notion is unreachable.
 *
 * THE CORE RULE THIS FILE FOLLOWS EVERYWHERE: NOTION SYNC NEVER BLOCKS THE
 * SAVE. A Postgres save has already succeeded by the time any of these
 * functions are called — Notion sync is additive, not a dependency the
 * core feature relies on. Every function here catches its own errors,
 * logs them, and returns normally rather than throwing, so a Notion
 * outage degrades to "this one edit didn't sync yet," never to "saving
 * milestones is broken."
 *
 * THE CLIENT-DEPENDENCY CHAIN
 * A milestone/session/resource's Notion page needs a relation to its
 * client's Notion page — which means the client must be synced first. If
 * a client has never been synced (no notion_page_id yet), syncing a
 * milestone first triggers syncing that client too, automatically, rather
 * than failing or skipping the relation.
 */

const db = require('./_db');
const notion = require('./_notion');

/**
 * Ensures the given client has a Notion page, creating one if it doesn't,
 * and returns that page's id. Safe to call even if the client was already
 * synced — in that case it just returns the existing notion_page_id
 * without making any Notion API calls at all.
 * @param {Object} client - a full client object from db.getClientById, including .id and .notionPageId
 * @returns {Promise<string|null>} the client's Notion page id, or null if syncing failed
 */
async function ensureClientSynced(client) {
  if (!client) return null;

  if (client.notionPageId) {
    return client.notionPageId;
  }

  try {
    // Even though we don't have a stored notion_page_id, a page might
    // already exist from a previous attempt that succeeded in Notion but
    // failed to save the id back to Postgres (e.g. a crash between the
    // two calls) — checking first avoids creating a duplicate.
    let page = await notion.findClientPage(client.id);
    if (!page) {
      page = await notion.createClientPage(client);
    }
    await db.updateClient({ id: client.id, notionPageId: page.id });
    return page.id;
  } catch (err) {
    console.error(`[notion-sync] Failed to sync client ${client.id} to Notion:`, err.message);
    return null;
  }
}

/**
 * Syncs a single client's profile fields to Notion (creating their page
 * first if needed). Call this after any client profile update.
 * @param {string} clientId
 */
async function syncClient(clientId) {
  try {
    const client = await db.getClientById(clientId);
    if (!client) return;

    const notionPageId = await ensureClientSynced(client);
    if (!notionPageId) return; // ensureClientSynced already logged the failure

    // ensureClientSynced may have just CREATED the page with this same
    // data, in which case this update is redundant but harmless — it's
    // simpler and safer than threading an "already just created" flag
    // through, and an extra PATCH costs nothing meaningful here.
    await notion.updateClientPage(notionPageId, client);
  } catch (err) {
    console.error(`[notion-sync] Failed to sync client ${clientId}:`, err.message);
  }
}

/**
 * Syncs a single milestone to Notion, ensuring its client is synced first.
 * @param {string} milestoneId
 * @param {string} clientId
 */
async function syncMilestone(milestoneId, clientId) {
  try {
    const client = await db.getClientById(clientId);
    const clientNotionPageId = await ensureClientSynced(client);

    const milestones = await db.getMilestonesForClient(clientId);
    const milestone = milestones.find(m => m.id === milestoneId);
    if (!milestone) return; // deleted between save and sync — nothing to do

    if (milestone.notionPageId) {
      await notion.updateMilestonePage(milestone.notionPageId, milestone, clientNotionPageId);
    } else {
      let page = await notion.findMilestonePage(milestone.id);
      if (!page) {
        page = await notion.createMilestonePage(milestone, clientNotionPageId);
      }
      await db.saveMilestone({ id: milestone.id, clientId: milestone.clientId, notionPageId: page.id });
    }
  } catch (err) {
    console.error(`[notion-sync] Failed to sync milestone ${milestoneId}:`, err.message);
  }
}

/**
 * Syncs a single session to Notion, ensuring its client is synced first.
 * @param {string} sessionId
 * @param {string} clientId
 */
async function syncSession(sessionId, clientId) {
  try {
    const client = await db.getClientById(clientId);
    const clientNotionPageId = await ensureClientSynced(client);

    const sessions = await db.getSessionsForClient(clientId);
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return;

    if (session.notionPageId) {
      await notion.updateSessionPage(session.notionPageId, session, clientNotionPageId);
    } else {
      let page = await notion.findSessionPage(session.id);
      if (!page) {
        page = await notion.createSessionPage(session, clientNotionPageId);
      }
      await db.saveSession({ id: session.id, clientId: session.clientId, notionPageId: page.id });
    }
  } catch (err) {
    console.error(`[notion-sync] Failed to sync session ${sessionId}:`, err.message);
  }
}

/**
 * Syncs a single resource to Notion, ensuring its client is synced first.
 * @param {string} resourceId
 * @param {string} clientId
 */
async function syncResource(resourceId, clientId) {
  try {
    const client = await db.getClientById(clientId);
    const clientNotionPageId = await ensureClientSynced(client);

    const resources = await db.getResourcesForClient(clientId);
    const resource = resources.find(r => r.id === resourceId);
    if (!resource) return;

    if (resource.notionPageId) {
      await notion.updateResourcePage(resource.notionPageId, resource, clientNotionPageId);
    } else {
      let page = await notion.findResourcePage(resource.id);
      if (!page) {
        page = await notion.createResourcePage(resource, clientNotionPageId);
      }
      await db.saveResource({ id: resource.id, clientId: resource.clientId, notionPageId: page.id });
    }
  } catch (err) {
    console.error(`[notion-sync] Failed to sync resource ${resourceId}:`, err.message);
  }
}

/**
 * Trashes the Notion page for a deleted milestone/session/resource/client,
 * if one exists. Looks up the page by Postgres ID rather than requiring
 * the caller to already know the Notion page id, since by the time this
 * runs the Postgres row is usually already gone (deleted first, then we
 * clean up Notion) — there's nowhere left to read a stored notion_page_id
 * from.
 * @param {'clients'|'milestones'|'sessions'|'resources'} dataSourceKey
 * @param {string} postgresId
 */
async function syncDeletion(dataSourceKey, postgresId) {
  const finders = {
    clients: notion.findClientPage,
    milestones: notion.findMilestonePage,
    sessions: notion.findSessionPage,
    resources: notion.findResourcePage,
  };
  const finder = finders[dataSourceKey];
  if (!finder) return;

  try {
    const page = await finder(postgresId);
    if (page) {
      await notion.trashPage(dataSourceKey, page.id);
    }
  } catch (err) {
    console.error(`[notion-sync] Failed to trash Notion page for deleted ${dataSourceKey} ${postgresId}:`, err.message);
  }
}

module.exports = {
  syncClient,
  syncMilestone,
  syncSession,
  syncResource,
  syncDeletion,
};
