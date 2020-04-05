const getParameterDefinitions = require('@jscad/core/parameters/getParameterDefinitions')
const getParameterValues = require('@jscad/core/parameters/getParameterValuesFromUIControls')
const { rebuildSolids, rebuildSolidsInWorker } = require('@jscad/core/code-evaluation/rebuildSolids')
const { mergeSolids } = require('@jscad/core/utils/mergeSolids')

// output handling
//const { generateOutputFile } = require('../io/generateOutputFile')
const { prepareOutput } = require('@jscad/core/io/prepareOutput')
const { convertToBlob } = require('@jscad/core/io/convertToBlob')
const { formats, supportedFormatsForObjects } = require('@jscad/core/io/formats')
const { generateOutputFile } = require('./generateOutputFile')
const Viewer = require('./jscad-viewer-lightgl')
const initZPad = require('./zpad')

var modelConfig = {
  name:"single", 
  model:"PrusaShieldRC3", 
  count:1, 
  modelJSCad:null,
  addDate:true
}; //"PrusaShield RC3 x1"
//var modelName = 'PrusaShieldRC3';  // or PrusaShieldRC3_4Stack
//var stackCount = 1; // or 4
var outputFile = null
var buildOutput
var downloadButton
var materialTypeDropdown
var quantityField
var dateDropdown
var addDateCheckbox; 
var nameField
var viewer
var needsUpdate
var updatingModel
var cancelUpdate
var lastInput
var updateModelMessageNodes
var selectedDate = new Date()
const inputTimeout = 200

const $ = (a, b) => document.getElementById(a, b)

function init(){
  initZPad()

  downloadButton = $('download-button')
  nameField = $("name-field")
  updateModelMessageNodes = document.getElementsByClassName("update-model")
  materialTypeDropdown = $("material-type")
  quantityField = $("stack-count")
  dateDropdown = $("selected-date")
  addDateCheckbox = $("add-date"); 
  //init 3d model viewer
  var containerdiv = $('viewerContainer')
  var viewerdiv = document.createElement('div')
  viewerdiv.className = 'viewer'
  viewerdiv.style.width = '100%'
  viewerdiv.style.height = '100%'
  containerdiv.appendChild(viewerdiv)
  viewer = new Viewer(viewerdiv,{
   // 3jscad-viewer-lightgl.js:298 {"position":{"x":16.850816779459187,"y":10.79013653116062,"z":192.0986346883937},"angle":{"x":-67.79999999999998,"y":1.6000000000000003,"z":65}}
    camera:{"position":{"x":16,"y":11,"z":192},"angle":{"x":-68,"y":1.6,"z":65}},
    plate:{
      draw:false,
    },
    axis:{
      draw:false
    } 
  })
  viewer.init()


  /* init model dropdown */
  
    modelConfig.modelFile = `models/${modelConfig.model}.jscad`
    fetch(modelConfig.modelFile).then(function(response){
      if(response.ok){
        response.text().then(function(val){
          modelConfig.modelJSCad = val
          updateModel()
          let option = document.createElement("option")
          option.innerText = modelConfig.name
          option.value = i
          quantityField.appendChild(option)
        })
        
      }else {
        console.error(response.statusText)
      }
    })
  

  quantityField.onchange = function(){
    modelConfig.count = parseInt( quantityField.value )
    updateModel();  
  }
  addDateCheckbox.onchange = function(){
    modelConfig.addDate = addDateCheckbox.checked
    updateModel();  
    console.log(modelConfig, addDateCheckbox.checked)
  }

  /* init material dropdown */
  materialTypeDropdown.onchange = function(){ lastInput=Date.now()-inputTimeout }



  /* init name field */
  nameField.oninput = function(){ lastInput=Date.now() }
  //input update check
  setInterval(inputUpdateCheck,100)
  

  /* init date dropdown */
  let days = ["today","+1 day","","","","","",""]
  days.forEach(function(text,offsetDays){
    if(text===""){
      text = `+${offsetDays} days`
    }
    let option = document.createElement("option")
    let date = new Date( Date.now() + offsetDays*24*3600*1000 );    
    option.innerText = `${text} - ${dateString(date)}`
    option.value = offsetDays
    dateDropdown.appendChild(option)
  })
  dateDropdown.onchange = function(){
    let offsetDays = parseInt( dateDropdown.value ) || 0
    selectedDate = new Date( Date.now() + offsetDays*24*3600*1000 ); 
    updateModel()
  }
 
  /* init download button */
  downloadButton.addEventListener('click',function(){
    onSaveInProgress(); 
    setTimeout(function(){
           
      generateFile();  
    },50)
  })


}

function inputUpdateCheck(){
  if(lastInput){
    var elapsed = Date.now()-lastInput
    if(elapsed>inputTimeout){
      lastInput = false
      updateModel()
    }
  }
}

const onSaveInProgress = () => downloadButton.disabled = true
const onSaveComplete = () => downloadButton.disabled = false

const onModelBuildStart = () => {
  downloadButton.disabled = true
  Array.prototype.slice.call(updateModelMessageNodes).forEach(n => n.style.visibility = "visible")
  i = updateModelMessageNodes.length
}

const onModelBuildComplete = () => {
  Array.prototype.slice.call(updateModelMessageNodes).forEach(n => n.style.visibility = "hidden")
  i = updateModelMessageNodes.length
  downloadButton.disabled = false 
  viewer.viewpointY = 11 - ((modelConfig.count*20.25)*0.5)
  viewer.onDraw()
}

const dateString = (date) => (
  date.getDate().pad(2)+"."+(date.getMonth()+1).pad(2)+"."+(date.getYear()-100).toString()
)

const dateStringBackwards = (date) => (
  date.getFullYear().toString()+"."+(date.getMonth()+1).pad(2)+"."+date.getDate().pad(2)
)

const dateStringFullYear = (date) => (
  date.getDate().pad(2)+"."+(date.getMonth()+1).pad(2)+"."+date.getFullYear().toString()
)


function updateModel(){
  if(updatingModel){
    
    if(cancelUpdate){
      cancelUpdate()
      cancelUpdate = null
    }
    else {
      needsUpdate = true
      return;      
    }
  }
  console.log("updating model")
  updatingModel = true
  onModelBuildStart()
  //const parameters = getParameterValues(this.paramControls)
  let name = nameField.value
  //if(name == "") name = "."; 
  
  let material = materialTypeDropdown.value
  
  let dateStr = dateString(selectedDate)
  let script = `
function main() { 
    let shield = ((model())); 

    let count = ${modelConfig.count}; 
    let name = "${name}"
    let labeloutlines1 = vector_text(0,0,"${material} ${dateStr}")
    let labelextruded1 = []
    let labeloutlines2 = vector_text(0,0,name)
    let labelextruded2 = []
    
    let depth=0.75
    let xpos = 87.6-depth; 
    let yposleft = -4; 
    let yposright = -37; 
    let zpos = -1.5; 
    labeloutlines1.forEach(function(pl) {                   // pl = polyline (not closed)
      labelextruded1.push(rectangular_extrude(pl, {w: 4, h: depth}));   // extrude it to 3D
    })
    labeloutlines2.forEach(function(pl) {                   // pl = polyline (not closed)
      labelextruded2.push(rectangular_extrude(pl, {w: 4, h: depth}));   // extrude it to 3D
    })
    let labelobject1 = union(labelextruded1)
    let labelobject2 = union(labelextruded2)
    let objectheight = 20.25; 
    
    let z = zpos + objectheight/2; 
    let labelsleft = (labelobject1.scale([0.15,0.15,1]).rotateX(90).rotateZ(-90).translate([-xpos,yposleft,z]))
    let labelsright = (labelobject2.scale([0.15,0.15,1]).rotateX(90).rotateZ(90).translate([xpos,yposright,z]))

    let subtractobject = cube(0); // is there a better way to create an empty object? 
    let issubtractobjectempty = true; 
    if(name!="") {
      subtractobject = subtractobject.union(labelsright); 
      issubtractobjectempty = false; 
    }
    if(${modelConfig.addDate}) {
      subtractobject = subtractobject.union(labelsleft); 
      issubtractobjectempty = false; 
    }

    if(!issubtractobjectempty) shield = shield.subtract(subtractobject); 

    let shields = []; 
    for(i = 0; i<count; i++) { 
        shields.push(shield.translate([0,0,i*objectheight]))
        if(i>0) {
            shields.push(supports().translate([0,0,objectheight*(i-1)]))
        }
        
    }
    if(count>1) shields.push(feet())
    return union(shields)
    
}


function centrePoly(poly) { 
    let bounds = poly.getBounds(); 
    let centre = bounds[1].plus(bounds[0]).scale(-0.5)
    return poly.translate([centre.x, centre.y, centre.z])
}
   `

   cancelUpdate = rebuildSolidsInWorker(script+modelConfig.modelJSCad,"",{},function(err,output){
    console.log(script)
    if(err){
      console.error(err)
      return
    }
    buildOutput = output
    if(output) viewer.setCsg(mergeSolids(output))
    if(needsUpdate) {
      needsUpdate = false
      setTimeout(function(){
        updateModel()
      })
    }
    updatingModel = false
    cancelUpdate = null
    console.log("model update complete")
    onModelBuildComplete()
  },{memFs:true}).cancel
  
}

var saveFile = (function () {
  var a = document.createElement("a")
  document.body.appendChild(a)
  a.style = "display: none"
  return function (blobUrl, fileName) {
    console.log("saving")
      a.href = blobUrl
      a.download = fileName
      a.click()
      setTimeout(function(){
        window.URL.revokeObjectURL(blobUrl);		        	
      })
  }
}())

function generateFile() {
  let objects = buildOutput
  console.log('generating file')
  let outputFormat = {
    displayName: 'STL (Binary)',
    description: 'STereoLithography, Binary',
    extension: 'stl',
    mimetype: 'application/sla',
    convertCSG: true,
    convertCAG: false
  }
  const blob = convertToBlob(prepareOutput(objects, { format: outputFormat.extension }))

  function onDone(data, downloadAttribute, blobMode, noData) {
    hasOutputFile = true
    outputFile = { data, downloadAttribute, blobMode, noData }
    saveFile(outputFile.data,`${modelConfig.model}-x${modelConfig.count}-${dateStringFullYear(selectedDate)}.stl`)
    onSaveComplete()
  }

  generateOutputFile("stl", blob, onDone, null);  
}

document.addEventListener('DOMContentLoaded', function (event) {
  init()
})

