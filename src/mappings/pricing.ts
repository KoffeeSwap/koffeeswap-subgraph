/* eslint-disable prefer-const */
import { Pair, Token, Bundle } from '../types/schema'
import { BigDecimal, Address, BigInt } from '@graphprotocol/graph-ts/index'
import { ZERO_BD, factoryContract, ADDRESS_ZERO, ONE_BD } from './helpers'

const WKCS_ADDRESS = '0x4446Fc4eb47f2f6586f9fAAb68B3498F86C07521'
//const USDC_WKCS_PAIR = '0x86c49ba0825fc1f736c67e5d58f49a76018d5e5a'
//const DAI_WKCS_PAIR = '0xa478c2975ab1ea89e8196811f51a7b7ade33eb11'
//const USDT_WKCS_PAIR = '0x3975f8e4fbeef251b58722d8ace3345fe8995206'

export function getKcsPriceInUSD(): BigDecimal {
  // fetch eth prices for each stablecoin
  //let daiPair = Pair.load(DAI_WKCS_PAIR) // dai is token0
  //let usdcPair = Pair.load(USDC_WKCS_PAIR) // usdc is token0
  //let usdtPair = Pair.load(USDT_WKCS_PAIR) // usdt is token1

  // all 3 have been created
  // if (daiPair !== null && usdcPair !== null && usdtPair !== null) {
  //   let totalLiquidityKCS = daiPair.reserve1.plus(usdcPair.reserve1).plus(usdtPair.reserve0)
  //   let daiWeight = daiPair.reserve1.div(totalLiquidityKCS)
  //   let usdcWeight = usdcPair.reserve1.div(totalLiquidityKCS)
  //   let usdtWeight = usdtPair.reserve0.div(totalLiquidityKCS)
  //   return daiPair.token0Price
  //     .times(daiWeight)
  //     .plus(usdcPair.token0Price.times(usdcWeight))
  //     .plus(usdtPair.token1Price.times(usdtWeight))
  //   // dai and USDC have been created
  // } else
  // if (usdcPair !== null && usdtPair !== null) {
  //   let totalLiquidityKCS = usdcPair.reserve0.plus(usdtPair.reserve1)
  //   let usdcWeight = usdcPair.reserve0.div(totalLiquidityKCS)
  //   let usdtWeight = usdtPair.reserve1.div(totalLiquidityKCS)
  //   return usdcPair.token1Price.times(usdcWeight).plus(usdtPair.token0Price.times(usdtWeight))
  //   // usdt is the only pair so far
  // } else if (usdcPair !== null) {
  //   return usdcPair.token1Price
  // } else {
    return ZERO_BD
  //}
}

// token where amounts should contribute to tracked volume and liquidity
let WHITELIST: string[] = [
  '0x4446Fc4eb47f2f6586f9fAAb68B3498F86C07521', // WKCS
  //'0xd6c7e27a598714c2226404eb054e0c074c906fc9', // USDC
  //'0x67f6a7bbe0da067a747c6b2bedf8abbf7d6f60dc'  // USDT
]

// minimum liquidity required to count towards tracked volume for pairs with small # of Lps
let MINIMUM_USD_THRESHOLD_NEW_PAIRS = BigDecimal.fromString('400000')

// minimum liquidity for price to get tracked
let MINIMUM_LIQUIDITY_THRESHOLD_KCS = BigDecimal.fromString('2')

/**
 * Search through graph to find derived Kcs per token.
 * @todo update to be derived KCS (add stablecoin estimates)
 **/
export function findKcsPerToken(token: Token): BigDecimal {
  if (token.id == WKCS_ADDRESS) {
    return ONE_BD
  }
  // loop through whitelist and check if paired with any
  for (let i = 0; i < WHITELIST.length; ++i) {
    let pairAddress = factoryContract.getPair(Address.fromString(token.id), Address.fromString(WHITELIST[i]))
    if (pairAddress.toHexString() != ADDRESS_ZERO) {
      let pair = Pair.load(pairAddress.toHexString())
      if (pair.token0 == token.id && pair.reserveKCS.gt(MINIMUM_LIQUIDITY_THRESHOLD_KCS)) {
        let token1 = Token.load(pair.token1)
        return pair.token1Price.times(token1.derivedKCS as BigDecimal) // return token1 per our token * Kcs per token 1
      }
      if (pair.token1 == token.id && pair.reserveKCS.gt(MINIMUM_LIQUIDITY_THRESHOLD_KCS)) {
        let token0 = Token.load(pair.token0)
        return pair.token0Price.times(token0.derivedKCS as BigDecimal) // return token0 per our token * KCS per token 0
      }
    }
  }
  return ZERO_BD // nothing was found return 0
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD.
 * If both are, return average of two amounts
 * If neither is, return 0
 */
export function getTrackedVolumeUSD(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token,
  pair: Pair
): BigDecimal {
  let bundle = Bundle.load('1')
  let price0 = token0.derivedKCS.times(bundle.kcsPrice)
  let price1 = token1.derivedKCS.times(bundle.kcsPrice)

  // if less than 5 LPs, require high minimum reserve amount amount or return 0
  if (pair.liquidityProviderCount.lt(BigInt.fromI32(5))) {
    let reserve0USD = pair.reserve0.times(price0)
    let reserve1USD = pair.reserve1.times(price1)
    if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
      if (reserve0USD.plus(reserve1USD).lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
        return ZERO_BD
      }
    }
    if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
      if (reserve0USD.times(BigDecimal.fromString('2')).lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
        return ZERO_BD
      }
    }
    if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
      if (reserve1USD.times(BigDecimal.fromString('2')).lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
        return ZERO_BD
      }
    }
  }

  // both are whitelist tokens, take average of both amounts
  if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount0
      .times(price0)
      .plus(tokenAmount1.times(price1))
      .div(BigDecimal.fromString('2'))
  }

  // take full value of the whitelisted token amount
  if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0)
  }

  // take full value of the whitelisted token amount
  if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount1.times(price1)
  }

  // neither token is on white list, tracked volume is 0
  return ZERO_BD
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD * 2.
 * If both are, return sum of two amounts
 * If neither is, return 0
 */
export function getTrackedLiquidityUSD(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token
): BigDecimal {
  let bundle = Bundle.load('1')
  let price0 = token0.derivedKCS.times(bundle.kcsPrice)
  let price1 = token1.derivedKCS.times(bundle.kcsPrice)

  // both are whitelist tokens, take average of both amounts
  if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0).plus(tokenAmount1.times(price1))
  }

  // take double value of the whitelisted token amount
  if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0).times(BigDecimal.fromString('2'))
  }

  // take double value of the whitelisted token amount
  if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount1.times(price1).times(BigDecimal.fromString('2'))
  }

  // neither token is on white list, tracked volume is 0
  return ZERO_BD
}
