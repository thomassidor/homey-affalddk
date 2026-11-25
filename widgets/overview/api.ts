/* Widget API: called from public/index.html as Homey.api('GET', '/overview?device=...&types=a,b') */
module.exports = {
  async getOverview({ homey, query }: { homey: any; query: Record<string, string> }) {
    const types = (query.types || '').split(',').map((s) => s.trim()).filter(Boolean);
    // the icons live in the Waste pickups widget's folder, as for the calendar
    return homey.app.getOverviewData(query.device || undefined, types, '../upcoming/');
  },
};
