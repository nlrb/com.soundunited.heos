const Homey = require('homey')

module.exports = [

    {
        method: 'GET',
        path:   '/accountGetStatus',
        public: true,
        fn: function(args, callback) {
            Homey.app.accountGetStatus().then((result) => callback(null, result))
        }
    },
    {
        method: 'PUT',
        path:   '/accountLogout',
        public: true,
        fn: function(args, callback) {
            Homey.app.accountLogout().then((result) => callback(null, result))
        }
    }

]
