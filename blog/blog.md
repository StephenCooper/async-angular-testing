# Angular fakeAsync

If you are working with an Angular application and writing tests at some point you are going to need to write tests for asynchronous behaviour. In this article we will show, with a complete code example, how to think about testing asynchronous code.

## Test Context

For the purpose of this article we will be testing an application that uses [AG Grid](https://ag-grid.com/). In the application there is a quick filter which is used to filter the rows in the grid based on the input from a text box. You can try the application out for yourself [here](https://plnkr.co/edit/ef2ozOyGVZlvT2wq?open=app%2Fapp.component.ts).

![Filter data by text input](./filter-by-germany.gif)

We are going to test that for the set of Olympic medal winners that we can filter to a specific country of interest.  Our test should validate that:

1. The grid initially shows the full set of data and our application displays the correct row count.
1. Upon entering the text "Germany" into the filter box the grid should filter the rows to German athletes and the displayed row count should match.

The reason for choosing this application, as an example for this article, is that it contains asynchronous code making it virtually impossible to test synchronously. 

## Application Code

The main parts of the component code are as follows. I have omitted some general properties for simplicity. It boils down to having a text input box that is bound to the `quickFilterText` string property on our component. We also show the current number of displayed rows in our template. The `quickFilterText` is bound to our grid component to enable it to filter the row data.

The current number of rows will be kept up to date by using the grid callback `(modelUpdated)` which is fired every time the grid model is updated, including when filtering is performed.

```html
<input id="quickFilter" type="text" [(ngModel)]="quickFilterText"/>

<div id="numberOfRows">Number of rows: {{ displayedRows }}</div>

<ag-grid-angular #grid
  [quickFilterText]="quickFilterText"
  (modelUpdated)="onModelUpdated($event)"
></ag-grid-angular>
```

When the model changes we get the latest displayed row count from the grid to update our template value.

```ts
export class AppComponent implements OnInit {
  public displayedRows: number = 0;
  public quickFilterText: string = '';

  @ViewChild('grid') grid: AgGridAngular;

  onModelUpdated(params: ModelUpdatedEvent) {
    this.displayedRows = params.api.getDisplayedRowCount();
  }
}

```

### Test helpers

Before we get to the tests let me quickly explain the assertion helper function we will be using. This function will give us an insight into the inner workings of our test, especially when we start working with asynchronous callbacks. 

The function validates all of the following:

- internal grid state
- state of the component variable, i.e `displayedRows`
- rendered HTML output of the `{{ displayedRows }}` binding

We will see that these values do *not* update at the same time due to asynchronous callbacks and when change detection is executed.

```ts
function validateState({ gridRows, displayedRows, templateRows }) {
  
    // Validate the internal grid model by calling its api method to get the row count
    expect(component.grid.api.getDisplayedRowCount())
      .withContext('api.getDisplayedRowCount')
      .toEqual(gridRows)
    
    // Validate the component property displayedRows
    expect(component.displayedRows)
      .withContext('component.displayedRows')
      .toEqual(displayedRows)

    // Validate the rendered html content that the user would see 
    expect(rowNumberDE.nativeElement.innerHTML)
      .withContext('<div> {{displayedRows}} </div>')
      .toContain("Number of rows: " + templateRows)
}
```

The `.withContext()` is a helpful Jasmine method to give us clearer error messages when values are not equal.

## Configuring the Test Module

 The first part of the test is to configure the test module. It requires AG Grid's `AgGridModule` and also Angular's `FormModule` to provided support for `ngModel`.
 

 ```ts
beforeEach(() => {
  TestBed.configureTestingModule({
    declarations: [AppComponent],
        imports: [AgGridModule, FormsModule],
    });
    // Create the test component fixture
    fixture = TestBed.createComponent(AppComponent);
    component = fixture.componentInstance;
    let compDebugElement = fixture.debugElement;

    // Get a reference to the quickFilter input and rendered template
    quickFilterDE = compDebugElement.query(By.css('#quickFilter'))
    rowNumberDE = compDebugElement.query(By.css('#numberOfRows'))
});
 ```
An important thing to point out here is what is missing from the `beforeEach` method. We have purposefully not run `fixture.detectChanges()` as part of our setup logic. By doing this we ensure that all our tests are as isolate as possible. It also enables us to make certain validations about our component before it is initialised. Finally, and most importantly when working with `fakeAsync` we do not want our component to be created outside of our `fakeAsync` context as otherwise this can lead to all sort of test inconsitencies and bugs.

> Note that we do not run fixture.detectChanges() inside the beforeEach method! This can lead to numerous issues when testing asynchronous code!
## Broken Synchronous Test

To prove that we need to handle this test asynchronously, lets show what happens if we try to write the test in a synchronous manner.

```ts
it('should filter rows by quickfilter (sync version)', (() => {

    // When the test starts our test harness component has been created but not our child grid component
    expect(component.grid).toBeUndefined()
    // Our first call to detectChanges, causes the grid to be created
    fixture.detectChanges()
    // Grid has now been created
    expect(component.grid.api).toBeDefined()

    // Run change detection to update template
    fixture.detectChanges()

    validateState({ gridRows: 1000, displayedRows: 1000, templateRows: 1000 })
  }))
```

While it looks like this test should pass it does not. We would expect that by the point we call `validateState` that each assertion would correctly show 1000 rows. In fact all that we see is that the internal grid model has 1000 rows but both the component property and rendered output are still 0. This results in the following errors:

```py
Error: component.displayedRows: Expected 0 to equal 1000.
Error: <div> {{displayedRows}} </div>: Expected 'Number of rows: 0 for' to contain 1000.
```

This shows that the grid setup code, which runs synchronously, has completed. This is why the internal grid state does have 1,000 rows at the time of our assertion. However, the component property is still showing a value of 0. This is because the grid callback is executed asynchronously and so is still in the Javascript event queue when we reach the assertion statement.

If you are not familiar with the Javascript event queue and how asynchronous tasks are run then you may find it beneficial to read these articles:
 - [JavaScript Visualized: Event Loop](https://dev.to/lydiahallie/javascript-visualized-event-loop-3dif)
 - [Tasks, microtasks, queues and schedules](https://jakearchibald.com/2015/tasks-microtasks-queues-and-schedules/)

As we cannot even validate the starting state of our test synchronously it is clear that we are going to need to update out tests to correctly handle asynchronous callbacks. 

# Writing an Async Test

We are going to cover two approaches for writing our test that handles the asynchronous grid behaviour:

 - Using `fakeAsync`
 - Using `async` `await`

## FakeAsync

As asynchronous code is very common, Angular provides us with the [fakeAsync](https://angular.io/api/core/testing/fakeAsync) test utility for testing this kind of code. It enables us to control the flow of time and when asynchronous tasks are executed with the methods `tick()` and `flush()`.

The high level concept with `fakeAsync` is that when the test comes to execute an asynchronous task it is added into a time based queue instead of actually being executed. As a developer we can choose when these tasks are actually run. If we want to run all the currently queued async tasks we call `flush()`. As the name suggests, this flushes all the queued up tasks out of the queue, executing them as they are removed from the queue. 

If we have code that uses `setTimeout(() => {}, 500)` with a time value, then this will get added to the fake async queue with a time delay of 500. We can use the `tick` function to advance time a given amount. This will walk through the queue and execute tasks that are scheduled before this time. So it gives us more control over how many tasks are removed from the queue as compared to flush.

It is worth noting that there is also a `flushMicrotasks()` function. For an example of when you might use `flushMicrotasks` instead of `flush` take a look at this article [Angular Testing Flush vs FlushMiscrotasks](https://www.damirscorner.com/blog/posts/20210702-AngularTestingFlushVsFlushMicrotasks.html).

### Controlling Change Detection in our test

You will see the following line of code `fixture.detectChanges()` in a lot of Angular tests. This enables you to control when change detection is run. As part of change detection Input bindings receive their updated values and html templates are re-rendered with the updated component values. Each of these are important when you want to validate that code is working correctly. In the test code below, we will highlight why we are required to call `fixture.detectChanges()` to progress our component state. 

### Quick Filter Test with FakeAsync

What follows is the full test code written using `fakeAsync` to validate that our application correctly filters the data in our grid and updates our template with the correct number of displayed rows. I have annotated every line of code to explain why we need it what it is doing.

#### Test setup

The first thing to do is wrap our test body in `fakeAsync`. This causes all async functions to be patched so that we can control their execution.

```ts
import { fakeAsync, flush } from '@angular/core/testing';

it('should filter rows by quickFilterText', fakeAsync(() => {
    ...
}))
```

When the test starts our application component has been created but it has not been initialised. i.e `ngOnInit` has not run. This means that our `<ag-grid-angular>` component has not been created or had data passed to it. To validate this, we can test that the grid is undefined at the start of the test.

The first call to `fixture.detectChanges()`, will create the grid and bind the component values to the grid via its @Inputs. When working with `fakeAsync` ensure the first call to `fixture.detectChanges()` is within the test body and **NOT** in a `beforeEach` section. This is vital as it means that during the construction of the grid all async function calls are correctly patched. It is also good practice to keep each test fully isolated from each other.

```ts
// At the start of the test the grid is undefined
expect(component.grid).toBeUndefined()

// Initialise our app component which creates our grid
fixture.detectChanges()

// Validate that the grid has now been created
expect(component.grid.api).toBeDefined()
```

Next we validate that the internal grid model is correct. It should have 1000 rows. However, at this point the asynchronous grid callbacks have not run. i.e the (modelUpdated) @Output has not fired.
This is why the internal grid state has 1000 rows, but the component and template still have 0 values.
```ts
// Validate the synchronous grid setup code has completed but not any async updates
validateState({ gridRows: 1000, displayedRows: 0, templateRows: 0 })
```

To run the callbacks that are currently in the fake task queue, we call `flush()`. This runs all the async tasks that were created during initialisation of the grid and any added during the flush itself, until the task queue is empty. It is likely that your async code creates new asynchronous tasks. Be default `flush()` will attempt to draining the queue of these newly added calls up to a default limit of 20 turns. If for some reason your async tasks trigger other async tasks more than 20 times you can increase this limit by passing it to flush. i.e `flush(100)`.

```ts
// Flush all async tasks from the queue
flush();
```

Now the component has its displayedRows property updated as (modelUpdated) executes. However, this is not reflected in the template as change detection has not run yet. For the rendered template to reflect the updated component property we need to trigger change detection. This causes the template to be re-rendered with the latest values from the component.

Our test state is now consistent. The internal grid model, component data and renderer template all correctly show 1000 rows before any filtering is applied.

```ts
// Validate that our component property has now been updated by the onModelUpdated callback
validateState({ gridRows: 1000, displayedRows: 1000, templateRows: 0 })
// Force the template to be updated
fixture.detectChanges()
// Component state is stable and consistent
validateState({ gridRows: 1000, displayedRows: 1000, templateRows: 1000 })
```
#### Update Filter Text

Now its time to enter our text into the filter text box. We set the filter value to 'Germany' and fire the input event which is required for `ngModel` to react to the filter change.

At this point the text input has been updated but the grid input binding, [quickFilterText]="quickFilterText", has not been updated as that requires change detection to have run. This is why even the internal grid model still reports 1000 rows after the filter change.

```ts
// Mimic user entering Germany
quickFilterDE.nativeElement.value = 'Germany'
quickFilterDE.nativeElement.dispatchEvent(new Event('input'));

// Input [quickFilterText]="quickFilterText" has not been updated yet so grid is not filtered
validateState({ gridRows: 1000, displayedRows: 1000, templateRows: 1000 })
```

We now trigger change detection to update the grid binding, [quickFilterText]="quickFilterText", with the value 'Germany'. We can then validate that the internal number of rows has been reduced to 68, the number of German rows. However, once again, the displayedRows has not been updated yet as the grid callbacks are asynchronous.

```ts
// Run change detection to push new filter value into the grid component
fixture.detectChanges()
// Grid uses filter value to update its internal model
validateState({ gridRows: 68, displayedRows: 1000, templateRows: 1000 })
```

We now flush our task queue again which causes the output event handler, `(modelUpdated), to fire and update our component displayedRows property. We then run change detection so that the template reflects the updated displayedRows value.

Our component test state is once again stable and we can validated that our quick filter and model update logic is correct.

```ts
//flush all the asynchronous callbacks.
flush()
// Component property is updated as the callback has now run
validateState({ gridRows: 68, displayedRows: 68, templateRows: 1000 })

// Run change detection to reflect the changes in our template
fixture.detectChanges()
validateState({ gridRows: 68, displayedRows: 68, templateRows: 68 })
```

## Full Test Code

Here is a more concise version of the test without all the intermediary validation steps. Hopefully it is now clear why we have this repeating pattern of `detectChanges` -> `flush` -> `detectChanges`. In both cases you can think of it as: update component inputs values, run async tasks of AG Grid and finally, update the template with the resulting values. 

```ts
it('should filter rows by quickFilterText using fakeAsync', fakeAsync(() => {
    
    // Setup grid, run async tasks, update HTML
    fixture.detectChanges()
    flush();
    fixture.detectChanges()

    // Validate full set of data is displayed
    validateState({ gridRows: 1000, displayedRows: 1000, templateRows: 1000 })

    // Update the filter text input
    quickFilterDE.nativeElement.value = 'Germany'
    quickFilterDE.nativeElement.dispatchEvent(new Event('input'));

    // Push filter text to grid, run async tasks, update HTML
    fixture.detectChanges()
    flush()
    fixture.detectChanges()

    // Validate correct number of rows are shown for our filter text
    validateState({ gridRows: 68, displayedRows: 68, templateRows: 68 })

  }))
```

### Using Auto Detect Changes

Now that we understand the data flow in the test above we can actually shorten this test further by taking advantage of the [fixture.autoDetectChanges()](https://angular.io/guide/testing-utility-apis#componentfixture-methods) method. 

> When autodetect is true, the test fixture calls detectChanges immediately after creating the component. Then it listens for pertinent zone events and calls detectChanges accordingly.
The default is false. Testers who prefer fine control over test behavior tend to keep it false.

```ts
it('should filter rows by quickFilterText using fakeAsync auto', fakeAsync(() => {

    // Setup grid and start aut detecting changes, run async tasks and have HTML auto updated 
    fixture.autoDetectChanges()
    flush();

    // Validate full set of data is displayed
    validateState({ gridRows: 1000, displayedRows: 1000, templateRows: 1000 })

    // Update the filter text input, auto detect changes updates the grid input
    quickFilterDE.nativeElement.value = 'Germany'
    quickFilterDE.nativeElement.dispatchEvent(new Event('input'));

    // Run async tasks, with auto detect then updating HTML
    flush()

    // Validate correct number of rows are shown for our filter text
    validateState({ gridRows: 68, displayedRows: 68, templateRows: 68 })
  }))
```

As you can see, writing the test with auto detect changes hides a lot of the complexity and so could be a good default starting point for your own asynchronous tests.

## Using async await

Another way that we can test our application is to use the built in [`async` and `await` syntax](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/async_function) along with the fixture method `fixture.whenStable()`. This can at times be a simpler way to write your test as you do not have to worry about manually flushing async tasks like with `fakeAsync`. Also there are cases when it is impossible to write a test with `fakeAsync` (i.e a recursive setTimeout function being used as a periodic timer that never lets the task queue empty during a flush), but it is possible with `async` and `await`.

Let's now re-write our test to work with `async` and `await`.

```ts
it('should filter rows by quickFilterText (async version)', (async () => {

    // Grid is created
    expect(component.grid).toBeUndefined()
    fixture.detectChanges()
    expect(component.grid.api).toBeDefined()

    // At this point in the test we see that the async callback onModelUpdated has not run
    validateState({ gridRows: 1000, displayedRows: 0, templateRows: 0 })

    // We wait for the fixture to be stable which allows all the asynchronous code to run.
    await fixture.whenStable()

    // Callbacks have now completed and our component property has been updated
    validateState({ gridRows: 1000, displayedRows: 1000, templateRows: 0 })
    // Run change detection to update the template
    fixture.detectChanges()
    validateState({ gridRows: 1000, displayedRows: 1000, templateRows: 1000 })

    // Now let's test that updating the filter text input does filter the grid data.
    // Set the filter to Germany
    quickFilterDE.nativeElement.value = 'Germany'
    quickFilterDE.nativeElement.dispatchEvent(new Event('input'));

    // We force change detection to run which applies the update to our <ag-grid-angular [quickFilterText] Input.
    fixture.detectChanges()

    // Async tasks have not run yet
    validateState({ gridRows: 68, displayedRows: 1000, templateRows: 1000 })

    // Again we wait for the asynchronous code to complete
    await fixture.whenStable()
    validateState({ gridRows: 68, displayedRows: 68, templateRows: 1000 })
    // Force template to update
    fixture.detectChanges()
    // Final test state achieved.
    validateState({ gridRows: 68, displayedRows: 68, templateRows: 68 })
  }))
```

As you may have noticed the structure of the test is very similar and we have just basically replaced `flush` with `await fixture.whenStable`. However, under the hood these tests are running in very different ways so this will not be a straight swap in many other examples.

Here is a concise version using `autoDetectChanges` which is our shortest working test so far. It is also conceptually the most simple to understand and hides a lot of the complexity from the tester. 

```ts
  it('should filter rows by quickFilterText (async version)', (async () => {
    
    // Run initial change detection and start watching for changes
    fixture.autoDetectChanges()
    // Wait for all the async task to complete before running validation
    await fixture.whenStable()

    validateState({ gridRows: 1000, displayedRows: 1000, templateRows: 1000 })

    // Set the filter to Germany
    quickFilterDE.nativeElement.value = 'Germany'
    quickFilterDE.nativeElement.dispatchEvent(new Event('input'));

    // Wait for callbacks to run
    await fixture.whenStable()

    // Changes automatically applied
    validateState({ gridRows: 68, displayedRows: 68, templateRows: 68 })
  }))
```

## Conclusion

We have taken a step by step walk through of an asynchronous Angular test. We explained how to write the test with both `fakeAsync` and `async` / `await`, starting with first principles and then showing how to take advantage of `autoDetectChanges`. I hope that you will have found this breakdown useful and it will enable you to confidently write tests for your applications' asynchronous behaviour. 
