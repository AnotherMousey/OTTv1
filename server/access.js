// Who may take part in / look at a tournament.
// access 'open' (default): every player. access 'invite': only the players the judge
// assigned (t.members, a list of user ids). t.hidden: the judge has hidden the tournament,
// so no player sees it at all. The judge can always see everything.
const isJudge = u => !!u && u.role === 'judge';
const isInviteOnly = t => t.access === 'invite';
const canPlay = (t, userId) => !isInviteOnly(t) || (t.members || []).includes(userId);
const canSee = (t, user) => isJudge(user) || (!!user && !t.hidden && canPlay(t, user.id));

module.exports = { isJudge, isInviteOnly, canPlay, canSee };
