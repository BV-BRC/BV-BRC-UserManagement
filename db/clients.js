var clients = [
    { id: '1', name: 'PATRIC3', clientId: 'patric3', clientSecret: 'patric3' },
    { id: '2', name: 'Samplr2', clientId: 'xyz123', clientSecret: 'ssh-password' }
];


exports.find = function(id, done) {
  for (var i = 0, len = clients.length; i < len; i++) {
    var client = clients[i];
    if (client.id === id) {
      return done(null, client);
    }
  }
  return done(null, null);
};

exports.findByClientId = function(clientId, done) {
  for (var i = 0, len = clients.length; i < len; i++) {
    var client = clients[i];
    if (client.clientId === clientId) {
      return done(null, client);
    }
  }
  return done(null, null);
};
