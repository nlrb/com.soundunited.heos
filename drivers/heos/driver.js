'use strict'

const Homey = require('homey')
const Discover 	= require('denon-heos').Discover
const DenonHeos = require('denon-heos').DenonHeos

const icons = {
  'HEOS HomeCinema': 'homecinema',
  'HEOS Amp': 'amp',
  'HEOS 1': 'heos1',
  'HEOS 3': 'heos3',
  'HEOS 5': 'heos5',
  'HEOS 7': 'heos7'
}

const heosevents = {
  'player_state_changed': { params: ['pid', 'state'] },
  'player_now_playing_changed': { params: ['pid'] },
  'player_now_playing_progress': { params: ['pid', 'cur_pos', 'duration'] },
  'player_playback_error': { params: ['pid', 'error'] },
  'player_queue_changed': { params: ['pid'] },
  'player_volume_changed': { params: ['pid', 'level', 'mute'] },
  'repeat_mode_changed': { params: ['pid', 'repeat'] },
  'shuffle_mode_changed': { params: ['pid', 'shuffle'] },
  'group_volume_changed': { params: ['gid', 'level', 'mute'] }
}

/*
   Structure of _foundDevices:
   {
     friendlyName: ...
     modelName: ...
     ...
     player: object from playerGetPlayerInfo
     instance: <DenonHeos> object [only for root device]
   }
*/

module.exports = class HeosDriver extends Homey.Driver {

	onInit() {
    this._root
    this._accountLogin = false
    this._pid2mac = {}
    this._foundDevices = {}
    this._playerQueue = {}
    this._groups = {}
    this._discover = new Discover()

    /* Can only start using this when it finds all devices
    const discoveryStrategy = this.getDiscoveryStrategy();
    discoveryStrategy.on('result', discoveryResult => {
      this.log('Got result:', discoveryResult);
    });
    */

    this._discover.on('device', device => {
			this.log('Found device', device.friendlyName, 'model', device.modelName)
      device.foundReachable = new Date()

      // Update our list of found devices
      if (!this._foundDevices[device.wlanMac]) {
        device.isAvailable = false // becomes 'true' when associated PID is found
        device.isReachable = true
        this._foundDevices[device.wlanMac] = device
        // Check if we already found the player info via CLI
        if (this._playerQueue[device.address]) {
          this.updatePlayersInfo(Object.values(this._playerQueue))
        }
      } else {
        this._foundDevices[device.wlanMac] = Object.assign(this._foundDevices[device.wlanMac], device)
      }

      // We need a root speaker to connect to and get all information from
      if (!this._root) {
        // Add DenonHeos instance for the rootDevice
        this._foundDevices[device.wlanMac].instance = new DenonHeos(device.address)
        this._root = device.wlanMac
        this.log('Root device:', device.friendlyName)
        this._registerListeners()
      }
    })
    this.startMainDiscover()

    // Login to Heos account once connected to the root player
    this.once('connected', async () => {
  		let account = Homey.ManagerSettings.get('account')
  		if (account) {
        try {
  		    let result = await this.accountLogin(account)
          if (result.login) {
            this.log('User', result.username, 'is logged in')
          } else {
            this.log('No user logged in', result.error)
          }
        } catch(err) {
          this.log(err)
        }
  		}
    })
	}

  /**
    @param {string} id Player wlanMac
    @return {boolean} true if player is online/reachable
  */
  getPlayerAvailable(id) {
    return this._foundDevices[id] && this._foundDevices[id].isAvailable
  }

  /**
    @param {string} id Player wlanMac
    @return {object} firmware & ip information
  */
  getPlayerVolatileSettings(id) {
    return this._foundDevices[id] && {
      ip: this._foundDevices[id].address,
      firmwareVersion: this._foundDevices[id].firmwareVersion,
      firmwareDate: this._foundDevices[id].firmwareDate,
      firmwareRevision: this._foundDevices[id].firmwareRevision
    }
  }

  /**
      @param {object} account Heos account credentials
   */
  accountLogin(account) {
    return new Promise((resolve, reject) => {
      let rootDevice = this._foundDevices[this._root]
      if (rootDevice && account) {
        rootDevice.instance.send('system/sign_in', { un: account.username, pw: account.password }, (err, result) => {
          if (err) {
            reject(err)
          } else {
            if (result.message.eid) {
              this._accountLogin = false
              resolve({ login: false, error: result.message.text, eid: result.message.eid })
            } else {
              this._accountLogin = true
              resolve({ login: true, username: result.message.un })
            }
          }
        })
      } else {
        reject('No root player available')
      }
    })
  }

  /**
      Log out of Heos account
   */
  accountLogout() {
    return new Promise((resolve, reject) => {
      let rootDevice = this._foundDevices[this._root]
      if (rootDevice) {
        rootDevice.instance.send('system/sign_out', {}, (err, result) => {
          if (err) {
            reject(err)
          } else {
            this._accountLogin = false
            resolve(result.message)
          }
        })
      } else {
        reject('No root player available')
      }
    })
  }

  /**
      Check if a user is logged in
   */
  accountCheck() {
    return new Promise((resolve, reject) => {
      let rootDevice = this._foundDevices[this._root]
      if (rootDevice) {
        rootDevice.instance.send('system/check_account', {}, (err, result) => {
          if (err) {
            reject(err)
          } else {
            if (result.message['signed_out'] !== '') {
              resolve({ login: true, username: result.message.un })
            } else {
              resolve({ login: false })
            }
          }
        })
      } else {
        reject('No root player available')
      }
    })
  }

  /**
    @param {string} command Heos CLI command to execute
    @param {} args Arguments to pass to the command
  */
  sendCommand(command, ...args) {
    return new Promise((resolve, reject) => {
      let rootDevice = this._foundDevices[this._root]
      if (rootDevice) {
        this.log('Sending', command, 'with', ...args)
        rootDevice.instance.send(command, ...args, (err, result) => {
          if (err) {
            // Due to errors, the player can get in a strange state.
            // Just to be sure, close the connection and connect to a (new) root player
            //this.startMainDiscover()
            reject(err)
          } else {
            resolve(result.payload || result.message)
          }
        })
      } else {
        // Find a new root player, but too late for this command
        this.startMainDiscover()
        reject('No root player available')
      }
    })
  }

  /**
    @param {string} id Player wlan Mac address
    @param {string} command Heos CLI command to execute
    @param {} args Arguments to pass to the command
  */
  sendPlayerCommand(id, command, ...args) {
    let pid = this.getPlayerId(id);
    if (pid) {
      let arg = Object.assign({ pid: pid }, ...args)
      return this.sendCommand(command, arg)
    } else {
      return Promise.reject('Cannot map mac ' + id + ' to pid')
    }
  }

  /**
    @param {string} id Player wlan Mac address
    @return {string} Heos player id (pid)
  */
  getPlayerId(id) {
    let pid;
    if (this._foundDevices[id] && this._foundDevices[id].player) {
      pid = this._foundDevices[id].player.pid.toString()
    }
    return pid;
  }

  /**
   * Main SSDP discovery: called when we know we need a root player
   */
  startMainDiscover() {
    this._removeRoot()
    this._socket = undefined
    this._discover.once('device', () => {
      setTimeout(() => this.connectRootPlayer(), 1000)
    })
    this._discover.start()
  }

  /**
   * Update SSDP discovery: called when there is reason to assume a player has gone offline or has come online
   * Sets: {boolean} isReachable
   *       {date} foundReachable
   */
  startUpdateDiscover() {
    this.log('Start update discover')
    this._discover.start()

    // Check after 3 seconds to see if a device is no longer discovered (discovery should be complete)
    setTimeout(() => {
      let now = new Date()
      let playerUpdateNeeded = false
      this.log('Check update results')
      for (let d in this._foundDevices) {
        // Check if the availability status has changed
        let device = this._foundDevices[d]
        let reachable = (now - device.foundReachable < 3000)
        this.log(d, device.friendlyName, device.isAvailable, reachable, now - device.foundReachable)
        this._foundDevices[d].isReachable = reachable
        // Check if there is a change in player reachability
        playerUpdateNeeded = playerUpdateNeeded || (device.isAvailable !== reachable)
      }
      if (playerUpdateNeeded) {
        this.log('Reachability has changed, getting player info')
        this.updatePlayers()
      }
    }, 3000)
  }

  /**
   * Connect to the root player and get current state of all players & groups
   */
  connectRootPlayer() {
    // TODO: make sure the API gets an 'isConnected'
    if (!this._socket) {
      let root = this._root
      let rootDevice = this._foundDevices[root]
      if (rootDevice) {
        this.log('Connecting to', rootDevice.friendlyName)
        this._socket = rootDevice.instance.connect(err => {
    	  if (err) {
            this.emit('disconnected')
            this.log('Connection failed:', err)
            this.log('Root player unavailable:', rootDevice.friendlyName)
            this.emit('unavailable', rootDevice.wlanMac)
            rootDevice.player && delete this._pid2mac[rootDevice.player.pid]
            // Check if connect error is from the current root device or not
            if (this._root === root) {
              this.startMainDiscover()
            } else {
              delete this._foundDevices[root]
			      }
          } else {
            // Register for change events
            rootDevice.instance.systemRegisterForChangeEvents(true, (err) => {
    					if (err) { this.log('Warning: no change events:', err) }
              this.emit('connected')
              this.updatePlayers()
    				})
            this.updateGroups()
          }
        })
      } else {
        this.startMainDiscover()
      }
    }
  }

  /**
   * Register the event listeners on the root device connection
   */
  _registerListeners() {
    this._foundDevices[this._root].instance
      .on('players_changed', () => {
        this.log('Event players_changed')
        this.updatePlayers()
        this.startUpdateDiscover()
      })
      .on('groups_changed', () => {
        this.log('Event groups_changed')
        this.updateGroups()
        this.startUpdateDiscover()
      })
    for (let on in heosevents) {
      this.log('Adding listener for', on)
      this._foundDevices[this._root].instance.on(on, (msg) => {
        let pid = msg.pid
        if (pid) {
          let mac = this._pid2mac[pid]
          if (mac) {
            delete msg.pid
            this.log('Emitting', mac, on, msg)
            this.emit(mac, on, msg)
          } else {
            this.log('Error: pid-mac mapping incomplete', pid, 'ignoring event', on)
          }
        } else {
          let gid = msg.gid
          if (gid) {
            for (let player in this._groups.players) {
              let mac = this._pid2mac[player.pid]
              this.log('Emitting', mac, on, msg)
              this.emit(mac, on, msg)
            }
          }
        }
      })
    }
  }

  /**
   * Remove the root device and event listeners
   */
  _removeRoot() {
	if (this._root && this._foundDevices[this._root]) {
    this.log('Removing all listeners and deleting root device')
	  this._foundDevices[this._root].instance.removeAllListeners();
    delete this._foundDevices[this._root];
	}
	this._root = undefined
  }

  /**
   * Get the Heos CLI player list information
   */
  updatePlayers() {
    this.log('updatePlayers')
    let rootDevice = this._foundDevices[this._root]
    if (rootDevice) {
  		rootDevice.instance.playerGetPlayers((err, players) => {
  			if (err) {
          // find a new root player
          this.log('Error getting players:', err)
          this.startMainDiscover()
          return
        }

  			if (!Array.isArray(players.payload)) return
        this.log('Players found:', players.payload.length)

        this.updatePlayersInfo(players.payload)
      })
    }
  }

  /**
   * Add player information from CLI to info from SSDP
   */
  updatePlayersInfo(players) {
    for (let d in this._foundDevices) {
      // Add the player info to the found devices - match on IP address
      let device = this._foundDevices[d]
      let id = players.findIndex(p => p.ip === device.address)
      if (id >= 0) {
        this._foundDevices[d].player = players[id]
        let pid = players[id].pid
        this._pid2mac[pid] = d;
        players[id].isMapped = true
        if (device.isAvailable !== true && device.isReachable === true) {
          this._foundDevices[d].isAvailable = true
          this.log('Player available:', device.friendlyName)
          this.emit('available', d)
        } else if (device.isAvailable === true && device.isReachable !== true) {
          this.log('Player unavailable:', device.friendlyName)
          this.emit('unavailable', d)
          delete this._pid2mac[pid]
          if (d === this._root) {
            // don't just delete the root device, we always need one
            this.startMainDiscover()
          } else {
			      delete this._foundDevices[d]
		      }
        }
      } else {
        this.log('Warning: player', this._foundDevices[d].friendlyName, 'not found by getPlayers!')
      }
  	}
    // Put all unmapped players in IP address queue
    this._playerQueue = {}
    players.forEach(p => { if (!p.isMapped && p.ip !== undefined) { this._playerQueue[p.ip] = p } })
    this.log('Players in queue:', Object.keys(this._playerQueue))
  }

  /**
   * Get Heos group information
   */
  updateGroups() {
    let rootDevice = this._foundDevices[this._root]
    if (rootDevice) {
      rootDevice.instance.groupGetGroups((err, groups) => {
        if (Array.isArray(groups.payload)) {
          this._groups = {}
          groups.payload.forEach(group => {
            this.log('Group', group.name)
            this._groups[group.gid] = {
              name: group.name,
              players: group.players
            }
          })
        }
      })
    }
  }

  /**
   * Called when Homey pairing process starts
   */
 	onPair(socket) {
		this.log('Heos speaker pairing has started...')

		socket.on('list_devices', async (data, callback) => {
      let devices = []

			for (let id in this._foundDevices) {
				let foundDevice = this._foundDevices[id]
        let player = foundDevice.player
        // only add player devices
        if (player !== undefined) {
  				let iconname = icons[player.model] || 'icon'
  				if (player.model.indexOf('AVR') >= 0) {
  					iconname = 'avr'
  				}
  				iconname = 'icons/' + iconname + '.svg'
  				this.log(player.name, iconname)

          let device = {
  					name: player.name,
  					data: {
  						id: id // wlan Mac
  					},
            settings: {
              brand: foundDevice.manufacturer,
              modelName: player.model,
              modelNumber: foundDevice.modelNumber,
              serialNumber: foundDevice.serialNumber === '' ? 'n/a' : foundDevice.serialNumber
            },
  					icon: iconname
  				}
          let settings = this.getPlayerVolatileSettings(id)
          Object.assign(device.settings, settings)
  				devices.push(device)
        }
			}
			callback(null, devices)
		})
	}
}
