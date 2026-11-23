// ======================================================
//  Lanka Glass Weather - app.js
//  Data comes from the free Open-Meteo APIs (no API key).
// ======================================================

// ---------- 1. Data and settings ----------

// Major Sri Lankan cities (approximate coordinates)
const cities = [
  { name: "Colombo",      lat: 6.9271, lon: 79.8612 },
  { name: "Kandy",        lat: 7.2906, lon: 80.6337 },
  { name: "Galle",        lat: 6.0535, lon: 80.2210 },
  { name: "Jaffna",       lat: 9.6615, lon: 80.0255 },
  { name: "Trincomalee",  lat: 8.5874, lon: 81.2152 },
  { name: "Batticaloa",   lat: 7.7310, lon: 81.6747 },
  { name: "Anuradhapura", lat: 8.3114, lon: 80.4037 },
  { name: "Nuwara Eliya", lat: 6.9497, lon: 80.7891 },
  { name: "Ratnapura",    lat: 6.7056, lon: 80.3847 },
  { name: "Kurunegala",   lat: 7.4863, lon: 80.3647 },
  { name: "Badulla",      lat: 6.9934, lon: 81.0550 },
  { name: "Hambantota",   lat: 6.1241, lon: 81.1185 }
];

// Everything the app currently remembers
const state = {
  lat: 6.9271,
  lon: 79.8612,
  name: "Colombo",
  weather: null,   // forecast JSON
  unit: "C"        // "C" or "F"
};

let map = null;
let selectedMarker = null;

// Shortcut so we can write $("id") instead of document.getElementById("id")
const $ = (id) => document.getElementById(id);

// ---------- 2. Small helper functions ----------

// Convert Open-Meteo weather codes into text + emoji icon
function describeWeather(code, isDay = 1) {
  if (code === 0)  return { text: "Clear sky",      icon: isDay ? "☀️" : "🌙" };
  if (code === 1)  return { text: "Mainly clear",   icon: isDay ? "🌤️" : "🌙" };
  if (code === 2)  return { text: "Partly cloudy",  icon: "⛅" };
  if (code === 3)  return { text: "Overcast",       icon: "☁️" };
  if (code === 45 || code === 48) return { text: "Fog", icon: "🌫️" };
  if (code >= 51 && code <= 57)   return { text: "Drizzle", icon: "🌦️" };
  if (code === 66 || code === 67) return { text: "Freezing rain", icon: "🌧️" };
  if (code === 65 || code === 82) return { text: "Heavy rain", icon: "🌧️" };
  if (code >= 61 && code <= 81 && code < 71) return { text: "Rain", icon: "🌧️" };
  if (code >= 71 && code <= 77)   return { text: "Snow", icon: "❄️" };
  if (code === 80 || code === 81) return { text: "Rain showers", icon: "🌦️" };
  if (code === 85 || code === 86) return { text: "Snow showers", icon: "🌨️" };
  if (code === 95) return { text: "Thunderstorm", icon: "⛈️" };
  if (code === 96 || code === 99) return { text: "Thunderstorm with hail", icon: "⛈️" };
  return { text: "Unknown", icon: "❓" };
}

// Show temperature in the unit the user picked
function formatTemp(celsius) {
  if (celsius === null || celsius === undefined) return "--";
  return state.unit === "C" ? Math.round(celsius) : Math.round(celsius * 9 / 5 + 32);
}

// Turn wind degrees (0-360) into N, NE, E ...
function windDirectionName(degrees) {
  const names = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
  return names[Math.round(degrees / 22.5) % 16];
}

// Put text into an element, or "--" when the value is missing
function setText(id, value) {
  $(id).textContent = (value === null || value === undefined) ? "--" : value;
}

// Find the nearest city in our list (used to name a map click)
function nearestCity(lat, lon) {
  let best = cities[0];
  let bestDistance = Infinity;
  for (const city of cities) {
    const distance = Math.hypot(city.lat - lat, city.lon - lon);
    if (distance < bestDistance) { bestDistance = distance; best = city; }
  }
  return best.name;
}

// ---------- 3. Loading the weather ----------

async function loadPlace(lat, lon, name) {
  state.lat = lat;
  state.lon = lon;
  state.name = name;

  $("loading").hidden = false;
  $("errorBox").hidden = true;
  setText("cityName", name);
  setText("placeName", name);
  setText("placeCoords", lat.toFixed(3) + ", " + lon.toFixed(3));

  // Air quality loads on its own, so if it fails the weather still shows
  loadAirQuality(lat, lon);

  try {
    const url = "https://api.open-meteo.com/v1/forecast"
      + "?latitude=" + lat + "&longitude=" + lon
      + "&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,is_day,pressure_msl,wind_speed_10m,wind_direction_10m"
      + "&hourly=temperature_2m,precipitation_probability,precipitation,weather_code,visibility,uv_index"
      + "&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_probability_max"
      + "&timezone=auto&forecast_days=7";

    const response = await fetch(url);
    if (!response.ok) throw new Error("Weather server returned " + response.status);

    state.weather = await response.json();
    renderWeather();
  } catch (error) {
    $("errorText").textContent = "Could not load weather data. " + error.message;
    $("errorBox").hidden = false;
  } finally {
    // Runs on success AND failure, so loading never gets stuck
    $("loading").hidden = true;
  }
}

async function loadAirQuality(lat, lon) {
  try {
    const url = "https://air-quality-api.open-meteo.com/v1/air-quality"
      + "?latitude=" + lat + "&longitude=" + lon
      + "&current=us_aqi,pm10,pm2_5,ozone&timezone=auto";
    const response = await fetch(url);
    if (!response.ok) throw new Error("Air quality error");
    const data = await response.json();
    renderAirQuality(data.current);
  } catch (error) {
    renderAirQuality(null);
  }
}

// ---------- 4. Drawing the dashboard ----------

// The hourly arrays start at midnight, so find the index for "now"
function currentHourIndex() {
  const nowHour = state.weather.current.time.slice(0, 13); // e.g. 2026-11-21T14
  const index = state.weather.hourly.time.findIndex((t) => t.startsWith(nowHour));
  return index === -1 ? 0 : index;
}

function renderWeather() {
  const { current, hourly, daily } = state.weather;
  const hourIndex = currentHourIndex();
  const info = describeWeather(current.weather_code, current.is_day);

  // Left sidebar
  setText("currentTemp", formatTemp(current.temperature_2m));
  $("bigIcon").textContent = info.icon;
  $("conditionIcon").textContent = info.icon;
  setText("conditionText", info.text);
  setText("rainChance", hourly.precipitation_probability[hourIndex]);
  const now = new Date(current.time);
  setText("dayName", now.toLocaleDateString("en-US", { weekday: "long" }) + ",");
  setText("timeText", current.time.slice(11, 16));
  document.querySelectorAll(".unit-label").forEach((el) => (el.textContent = "°" + state.unit));

  // Highlight cards
  setText("windValue", current.wind_speed_10m);
  setText("windDir", windDirectionName(current.wind_direction_10m));
  setText("humidityValue", current.relative_humidity_2m);
  setText("humidityNote", current.relative_humidity_2m > 70 ? "Humid 💦" : current.relative_humidity_2m < 40 ? "Dry 🌵" : "Normal 👍");
  const visibilityMeters = hourly.visibility[hourIndex];
  setText("visibilityValue", visibilityMeters == null ? null : (visibilityMeters / 1000).toFixed(1));
  setText("feelsLike", formatTemp(current.apparent_temperature));
  setText("pressure", Math.round(current.pressure_msl));
  setText("sunriseTime", daily.sunrise[0].slice(11, 16));
  setText("sunsetTime", daily.sunset[0].slice(11, 16));

  renderUv(hourly.uv_index[hourIndex]);
  renderWeek(daily);
  renderHourly(hourly, hourIndex);
  renderRainChart(hourly, hourIndex);
}

function renderUv(uv) {
  const value = uv == null ? 0 : uv;
  let advice = "Low - no protection needed.";
  if (value >= 3)  advice = "Moderate - wear sunglasses.";
  if (value >= 6)  advice = "High - use sunscreen and a hat.";
  if (value >= 8)  advice = "Very high - avoid midday sun.";
  if (value >= 11) advice = "Extreme - stay indoors if you can.";
  setText("uvValue", uv == null ? null : uv.toFixed(1));
  setText("uvNote", advice);
  $("uvMarker").style.left = Math.min(value / 12, 1) * 100 + "%";
}

function renderAirQuality(current) {
  if (!current || current.us_aqi == null) {
    setText("aqiValue", "N/A");
    setText("aqiLabel", "Not available");
    setText("pm25", null); setText("pm10", null); setText("ozone", null);
    $("aqiMarker").style.left = "0%";
    return;
  }
  const aqi = current.us_aqi;
  let label = "Good";
  if (aqi > 50)  label = "Moderate";
  if (aqi > 100) label = "Unhealthy for Sensitive Groups";
  if (aqi > 150) label = "Unhealthy";
  if (aqi > 200) label = "Very Unhealthy";
  if (aqi > 300) label = "Hazardous";
  setText("aqiValue", aqi);
  setText("aqiLabel", label);
  setText("pm25", current.pm2_5);
  setText("pm10", current.pm10);
  setText("ozone", current.ozone);
  $("aqiMarker").style.left = Math.min(aqi / 500, 1) * 100 + "%";
}

function renderWeek(daily) {
  let html = "";
  for (let i = 0; i < daily.time.length; i++) {
    const day = new Date(daily.time[i] + "T12:00").toLocaleDateString("en-US", { weekday: "short" });
    const icon = describeWeather(daily.weather_code[i]).icon;
    html += `
      <div class="week-card">
        <div>${day}</div>
        <div class="icon">${icon}</div>
        <div>${formatTemp(daily.temperature_2m_max[i])}° <span class="low">${formatTemp(daily.temperature_2m_min[i])}°</span></div>
        <div class="rain">💧 ${daily.precipitation_probability_max[i] ?? "--"}%</div>
      </div>`;
  }
  $("weekView").innerHTML = html;
}

function renderHourly(hourly, startIndex) {
  let html = "";
  for (let i = startIndex; i < startIndex + 24 && i < hourly.time.length; i++) {
    const icon = describeWeather(hourly.weather_code[i]).icon;
    html += `
      <div class="hour-card">
        <div>${hourly.time[i].slice(11, 16)}</div>
        <div class="icon">${icon}</div>
        <div>${formatTemp(hourly.temperature_2m[i])}°</div>
        <div class="rain">💧 ${hourly.precipitation_probability[i] ?? "--"}%</div>
      </div>`;
  }
  $("hourlyRow").innerHTML = html;
}

// Simple bar chart: one bar per hour, height = millimetres of rain
function renderRainChart(hourly, startIndex) {
  const amounts = hourly.precipitation.slice(startIndex, startIndex + 24);
  const biggest = Math.max(1, ...amounts); // at least 1 so flat days look flat
  const total = amounts.reduce((sum, mm) => sum + (mm || 0), 0);
  let html = "";
  for (const mm of amounts) {
    html += `<div class="rain-bar" title="${mm} mm" style="height:${((mm || 0) / biggest) * 100}%"></div>`;
  }
  $("rainChart").innerHTML = html;
  $("rainTotal").textContent = "· " + total.toFixed(1) + " mm";
}

// ---------- 5. Map ----------

// ---------- 6. Search ----------

// ---------- 7. Buttons and tabs ----------


// Switch between Today and Week views
function showTab(tab) {
  $("tabToday").classList.toggle("active", tab === "today");
  $("tabWeek").classList.toggle("active", tab === "week");
  $("todayView").hidden = tab !== "today";
  $("weekView").hidden = tab !== "week";
}
$("tabToday").addEventListener("click", () => showTab("today"));
$("tabWeek").addEventListener("click", () => showTab("week"));


// ---------- 8. Start the app ----------
loadPlace(state.lat, state.lon, state.name);
