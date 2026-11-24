/* Widget API: called from public/index.html as Homey.api('GET', '/calendar?device=...&weeks=...') */
module.exports = {
  async getCalendar({ homey, query }: { homey: any; query: Record<string, string> }) {
    // the icons live in the Waste pickups widget's folder (Homey serves each widget's public/ at /widgets/<id>/)
    return homey.app.getCalendarData(query.device || undefined, Number(query.weeks) || 5, '../upcoming/');
  },
};
