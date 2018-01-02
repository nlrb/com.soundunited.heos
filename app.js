'use strict'

const Homey = require('homey')

class HeosApp extends Homey.App {

  async onInit() {
		this.log('D&M Heos is running...')
		this.driver = await Homey.ManagerDrivers.getDriver('heos')

		this.on('login', result => {
			this.log(result)
			Homey.ManagerApi.realtime('login', result)
		})

		// Login to Heos account when settings credentials are saved
		Homey.ManagerSettings.on('set', async (key) => {
			if (key === 'account') {
				try {
					let account = Homey.ManagerSettings.get('account')
					let result = await this.driver.accountCheck()
					if (result.login) {
						if (result.username === account.username) {
							this.log('Already logged in')
							this.emit('login', { state: true, username: account.username })
						} else {
							result = await this.driver.accountLogout()
							this.accountLogin(account)
						}
					} else {
						this.accountLogin(account)
					}
				} catch(err) {
					this.log(err)
				}
			}
		})
	}

	async accountLogin(account) {
		try {
			let result = await this.driver.accountLogin(account)
			this.emit('login', result)
		} catch(err) {
			this.log(err)
		}
	}

	async accountGetStatus() {
		try {
			return await this.driver.accountCheck()
		} catch(err) {
			this.log(err)
		}
	}

	async accountLogout() {
		try {
			return await this.driver.accountLogout()
		} catch(err) {
			this.log(err)
		}
	}

}

module.exports = HeosApp
