/* Widget API: called from public/index.html as Homey.api('GET', '/pickups?device=...&rows=...') */
module.exports = {
  async getPickups({ homey, query }: { homey: any; query: Record<string, string> }) {
    return homey.app.getWidgetData(query.device || undefined, Number(query.rows) || 4);
  },
};
