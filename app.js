var STC = require("space_tycoon_client")
STC.ApiClient.instance.basePath = "http://localhost" // for development
STC.ApiClient.instance.enableCookies = true
var api = new STC.GameApi

const loginUser = process.argv[2] || "spaceman"
const loginPassword = process.argv[3] || "123456"
const loginPlayer = process.argv[4] || loginUser

var currentTick = 0
var staticData
var data
var me = -1
var forbiddenPlanets = {}

function prepareForbidden(pid, rid) {
	if (typeof forbiddenPlanets[pid] === "undefined")
		forbiddenPlanets[pid] = {}
	if (typeof forbiddenPlanets[pid][rid] === "undefined")
		forbiddenPlanets[pid][rid] = false
}

function isForbidden(pid, rid) {
	prepareForbidden(pid, rid)
	return forbiddenPlanets[pid][rid]
}

function setForbidden(pid, rid) {
	prepareForbidden(pid, rid)
	forbiddenPlanets[pid][rid] = true
}

function distance(a, b) {
	let sqr = x => x * x
	return Math.sqrt(sqr(a[0] - b[0]) + sqr(a[1] - b[1]))
}

// returns [ target, price, distance ]
function findBestToSell(startPos, rid) {
	let bestGain = 0
	let result = []
	for (let pid of Object.keys(data.planets)) {
		let planet = data.planets[pid]
		let resource = planet.resources[rid]
		if (!resource)
			continue
		let sellPrice = resource["sell-price"]
		if (!sellPrice)
			continue
		let distToPlanet = distance(startPos, planet.position)
		let gain = sellPrice / distToPlanet
		if (gain > bestGain) {
			result = [pid, sellPrice, distToPlanet]
			bestGain = gain
		}
	}
	return result
}

// returns [ target, resource, amount ]
function findBestToBuy(startPos, capacity) {
	let bestGain = 0
	let result = []
	for (let pid of Object.keys(data.planets)) {
		let planet = data.planets[pid]
		let distToPlanet = distance(startPos, planet.position)
		for (let rid of Object.keys(planet.resources)) {
			if (isForbidden(pid, rid))
				continue
			let resource = planet.resources[rid]
			let buyPrice = resource["buy-price"]
			if (!buyPrice)
				continue
			let am = Math.min(capacity, resource.amount)
			let sell = findBestToSell(planet.position, rid)
			if (sell.length !== 3)
				continue
			let sellPrice = sell[1]
			let dist = distToPlanet + sell[2]
			let gain = am * (sellPrice - buyPrice) / dist
			if (gain > bestGain) {
				result = [pid, rid, am]
				bestGain = gain
			}
		}
	}
	return result
}

function handleTradeShip(sid, ship, cls) {
	let capacity = cls["cargo-capacity"]
	if (capacity === 0)
		return
	if (Object.keys(ship.resources).length > 0) {
		let rid = Object.keys(ship.resources)[0]
		let resource = ship.resources[rid]
		let sell = findBestToSell(ship.position, rid)
		if (sell.length === 3) {
			let cmd = new STC.TradeCommand(-resource.amount, rid, sell[0])
			cmd.type = "trade"
			return cmd
		}
	} else {
		let buy = findBestToBuy(ship.position, capacity)
		if (buy.length === 3) {
			setForbidden(buy[0], buy[1])
			let cmd = new STC.TradeCommand(buy[2], buy[1], buy[0])
			cmd.type = "trade"
			return cmd
		}
	}
}

function handleShipyardShip(sid, ship, cls) {
	if (!cls["shipyard"])
		return
	let money = data.players[me]["net-worth"].money
	if (money < 1000000)
		return
	let cmd = new STC.ConstructCommand("3") // 3 = shipper
	cmd.type = "construct"
	return cmd
}

function compute() {
	console.log("Tick: " + data["current-tick"].tick + ", Money: " + data.players[me]["net-worth"].money + ", Ships: " + data.players[me]["net-worth"].ships + ", Resources: " + data.players[me]["net-worth"].resources + ", Total: " + data.players[me]["net-worth"].total)

	forbiddenPlanets = {}
	let orders = {}
	for (let sid of Object.keys(data.ships)) {
		let ship = data.ships[sid]
		if (ship.player !== me)
			continue
		let cls = staticData["ship-classes"][ship["ship-class"]]
		let order = handleShipyardShip(sid, ship, cls)
		if (!order)
			order = handleTradeShip(sid, ship, cls)
		if (order)
			orders[sid] = order
	}

	if (orders.length === 0)
		return

	api.commandsPost(orders, function (error, data2, response) {})
}

function timerLoop() {
	if (!staticData) {
		api.staticDataGet({}, function (error, data2, response) {
			staticData = data2
		})
	}

	api.currentTickGet(function (error, data1, response) {
		if (!data1) {
			login()
			staticData = undefined
			return
		}

		setTimeout(timerLoop, data1["min-time-left-ms"])
		if (currentTick === data1.tick)
			return
		currentTick = data1.tick

		api.dataGet({}, function (error, data3, response) {
			if (staticData) {
				data = data3
				if (me !== data["player-id"]) {
					console.error("invalid player id")
					return
				}
				compute()
			}
		})
	})
}

function login() {
	console.log("login as user: " + loginUser + ", player: " + loginPlayer)
	api.loginPost({ "username": loginUser, "password": loginPassword, "player": loginPlayer }, function (error, data4, response) {
		me = response.body.id
		if (!me) {
			console.error("failed login")
			return
		}
		setTimeout(timerLoop, 0)
	})
}

login()
