using System.Reflection;
using System.Security.Claims;
using FluentAssertions;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Moq;
using UniDipVeri.Application.Features.Auth.Abstractions;
using UniDipVeri.Application.Features.Auth.Models;
using UniDipVeri.Application.Features.Staff.Abstractions;
using UniDipVeri.Application.Features.Staff.Models;
using UniDipVeri.Domain.Enums;
using UniDipVeri.WebApi.Controllers;

namespace UniDipVeri.WebApi.Tests.Controllers;

public class StaffControllerTests
{
    private readonly Mock<IAuthService> _authServiceMock = new();
    private readonly Mock<IStaffService> _staffServiceMock = new();
    private readonly Mock<IAuthenticationService> _authenticationServiceMock = new();
    private readonly StaffController _controller;

    public StaffControllerTests()
    {
        _controller = new StaffController(_authServiceMock.Object, _staffServiceMock.Object);

        var serviceProviderMock = new Mock<IServiceProvider>();
        serviceProviderMock
            .Setup(sp => sp.GetService(typeof(IAuthenticationService)))
            .Returns(_authenticationServiceMock.Object);

        _controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                RequestServices = serviceProviderMock.Object
            }
        };
    }

    private void SetAdminUser()
    {
        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()),
            new Claim(ClaimTypes.Role, "ADMIN"),
            new Claim("user_type", "staff")
        };
        var identity = new ClaimsIdentity(claims, "TestAuth");
        _controller.ControllerContext.HttpContext.User = new ClaimsPrincipal(identity);
        _authServiceMock.Setup(s => s.RequireRole(It.IsAny<ClaimsPrincipal>(), StaffRole.ADMIN))
            .Returns(true);
    }

    private void SetNonAdminUser(StaffRole role = StaffRole.REGISTRAR)
    {
        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()),
            new Claim(ClaimTypes.Role, role.ToString()),
            new Claim("user_type", "staff")
        };
        var identity = new ClaimsIdentity(claims, "TestAuth");
        _controller.ControllerContext.HttpContext.User = new ClaimsPrincipal(identity);
        _authServiceMock.Setup(s => s.RequireRole(It.IsAny<ClaimsPrincipal>(), StaffRole.ADMIN))
            .Returns(false);
    }

    private void SetUnauthenticatedUser()
    {
        _controller.ControllerContext.HttpContext.User = new ClaimsPrincipal(new ClaimsIdentity());
        _authServiceMock.Setup(s => s.RequireRole(It.IsAny<ClaimsPrincipal>(), StaffRole.ADMIN))
            .Returns(false);
    }

    #region Controller Attributes Tests

    [Fact]
    public void StaffController_ShouldHaveRouteAttribute_AndLoginActionShouldHaveHttpPostLogin()
    {
        // Assert controller has ApiController and Route
        typeof(StaffController).GetCustomAttribute<ApiControllerAttribute>().Should().NotBeNull();
        var routeAttr = typeof(StaffController).GetCustomAttribute<RouteAttribute>();
        routeAttr.Should().NotBeNull();
        routeAttr!.Template.Should().Be("api/staffs");

        // Assert Login method has HttpPostAttribute matching login
        var method = typeof(StaffController).GetMethod(nameof(StaffController.Login));
        method.Should().NotBeNull();

        var postAttrs = method!.GetCustomAttributes<HttpPostAttribute>().ToList();
        postAttrs.Should().Contain(a => a.Template == "login");
    }

    [Theory]
    [InlineData(nameof(StaffController.CreateStaff), typeof(HttpPostAttribute))]
    [InlineData(nameof(StaffController.ListStaff), typeof(HttpGetAttribute))]
    [InlineData(nameof(StaffController.GetStaffById), typeof(HttpGetAttribute))]
    [InlineData(nameof(StaffController.UpdateStaff), typeof(HttpPatchAttribute))]
    [InlineData(nameof(StaffController.DeactivateStaff), typeof(HttpPostAttribute))]
    public void StaffEndpoints_ShouldHaveAuthorizeAdminAttribute_AndCorrectHttpMethods(
        string actionName, Type expectedHttpAttribute)
    {
        var method = typeof(StaffController).GetMethod(actionName);
        method.Should().NotBeNull();

        var authAttr = method!.GetCustomAttribute<AuthorizeAttribute>();
        authAttr.Should().NotBeNull();
        authAttr!.Roles.Should().Be("ADMIN");

        method.GetCustomAttribute(expectedHttpAttribute).Should().NotBeNull();
    }

    #endregion

    #region Login Tests

    [Theory]
    [InlineData(StaffRole.REGISTRAR, "REGISTRAR")]
    [InlineData(StaffRole.APPROVER, "APPROVER")]
    [InlineData(StaffRole.ADMIN, "ADMIN")]
    public async Task Login_ShouldReturn200WithUser_WhenActiveStaffCredentialsAreValid(
        StaffRole role,
        string roleClaim)
    {
        // Arrange
        var request = new LoginRequest($"{role.ToString().ToLower()}@miu.edu", "Password123!");
        var expectedUser = new AuthUserInfo(Guid.NewGuid(), request.Email, roleClaim, "staff");
        _authServiceMock.Setup(s => s.AuthenticateStaffAsync(request.Email, request.Password, It.IsAny<CancellationToken>()))
            .ReturnsAsync(AuthResult.Success(expectedUser));

        // Act
        var result = await _controller.Login(request, CancellationToken.None);

        // Assert
        result.Should().BeOfType<OkObjectResult>();
        var okResult = (OkObjectResult)result;
        okResult.StatusCode.Should().Be(200);

        var user = okResult.Value as AuthUserInfo;
        user.Should().NotBeNull();
        user!.Role.Should().Be(roleClaim);
        user.Email.Should().Be(request.Email);

        _authenticationServiceMock.Verify(a => a.SignInAsync(
            It.IsAny<HttpContext>(),
            CookieAuthenticationDefaults.AuthenticationScheme,
            It.IsAny<ClaimsPrincipal>(),
            It.IsAny<AuthenticationProperties>()), Times.Once);

        _authServiceMock.Verify(s => s.AuthenticateStaffAsync(request.Email, request.Password, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Login_ShouldReturn401_WhenStaffAccountIsInactive()
    {
        // Arrange
        var request = new LoginRequest("inactive@miu.edu", "Password123!");
        _authServiceMock.Setup(s => s.AuthenticateStaffAsync(request.Email, request.Password, It.IsAny<CancellationToken>()))
            .ReturnsAsync(AuthResult.Failure("Invalid email or password."));

        // Act
        var result = await _controller.Login(request, CancellationToken.None);

        // Assert
        result.Should().BeOfType<UnauthorizedObjectResult>();
        var unauthorizedResult = (UnauthorizedObjectResult)result;
        unauthorizedResult.StatusCode.Should().Be(401);
    }

    [Fact]
    public async Task Login_ShouldReturn401_WhenPasswordIsIncorrect()
    {
        // Arrange
        var request = new LoginRequest("staff@miu.edu", "WrongPassword!");
        _authServiceMock.Setup(s => s.AuthenticateStaffAsync(request.Email, request.Password, It.IsAny<CancellationToken>()))
            .ReturnsAsync(AuthResult.Failure("Invalid email or password."));

        // Act
        var result = await _controller.Login(request, CancellationToken.None);

        // Assert
        result.Should().BeOfType<UnauthorizedObjectResult>();
        var unauthorizedResult = (UnauthorizedObjectResult)result;
        unauthorizedResult.StatusCode.Should().Be(401);
    }

    [Fact]
    public async Task Login_ShouldReturn401_WhenStaffNotFound()
    {
        // Arrange
        var request = new LoginRequest("unknown@miu.edu", "Password123!");
        _authServiceMock.Setup(s => s.AuthenticateStaffAsync(request.Email, request.Password, It.IsAny<CancellationToken>()))
            .ReturnsAsync(AuthResult.Failure("Invalid email or password."));

        // Act
        var result = await _controller.Login(request, CancellationToken.None);

        // Assert
        result.Should().BeOfType<UnauthorizedObjectResult>();
        var unauthorizedResult = (UnauthorizedObjectResult)result;
        unauthorizedResult.StatusCode.Should().Be(401);
    }

    [Fact]
    public async Task Login_ShouldReturn401_WhenRequestBodyIsNull()
    {
        // Act
        var result = await _controller.Login(null, CancellationToken.None);

        // Assert
        result.Should().BeOfType<UnauthorizedObjectResult>();
        var unauthorizedResult = (UnauthorizedObjectResult)result;
        unauthorizedResult.StatusCode.Should().Be(401);

        _authServiceMock.Verify(s => s.AuthenticateStaffAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Theory]
    [InlineData("", "pass")]
    [InlineData("   ", "pass")]
    [InlineData("staff@miu.edu", "")]
    [InlineData("staff@miu.edu", "   ")]
    public async Task Login_ShouldReturn401_WhenEmailOrPasswordIsEmptyOrWhitespace(string email, string password)
    {
        // Arrange
        var request = new LoginRequest(email, password);

        // Act
        var result = await _controller.Login(request, CancellationToken.None);

        // Assert
        result.Should().BeOfType<UnauthorizedObjectResult>();
        var unauthorizedResult = (UnauthorizedObjectResult)result;
        unauthorizedResult.StatusCode.Should().Be(401);

        _authServiceMock.Verify(s => s.AuthenticateStaffAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    #endregion

    #region Authorization Guards on CRUD Endpoints

    [Fact]
    public async Task Endpoints_ShouldReturn401_WhenUserIsUnauthenticated()
    {
        // Arrange
        SetUnauthenticatedUser();

        // Act
        var createResult = await _controller.CreateStaff(new CreateStaffRequest());
        var listResult = await _controller.ListStaff();
        var getResult = await _controller.GetStaffById(Guid.NewGuid());
        var updateResult = await _controller.UpdateStaff(Guid.NewGuid(), new UpdateStaffRequest());
        var deactivateResult = await _controller.DeactivateStaff(Guid.NewGuid());

        // Assert
        createResult.Should().BeOfType<UnauthorizedObjectResult>();
        listResult.Should().BeOfType<UnauthorizedObjectResult>();
        getResult.Should().BeOfType<UnauthorizedObjectResult>();
        updateResult.Should().BeOfType<UnauthorizedObjectResult>();
        deactivateResult.Should().BeOfType<UnauthorizedObjectResult>();
    }

    [Fact]
    public async Task Endpoints_ShouldReturn403_WhenUserIsNotAdmin()
    {
        // Arrange
        SetNonAdminUser(StaffRole.REGISTRAR);

        // Act
        var createResult = await _controller.CreateStaff(new CreateStaffRequest());
        var listResult = await _controller.ListStaff();
        var getResult = await _controller.GetStaffById(Guid.NewGuid());
        var updateResult = await _controller.UpdateStaff(Guid.NewGuid(), new UpdateStaffRequest());
        var deactivateResult = await _controller.DeactivateStaff(Guid.NewGuid());

        // Assert
        createResult.Should().BeOfType<ObjectResult>().Which.StatusCode.Should().Be(403);
        listResult.Should().BeOfType<ObjectResult>().Which.StatusCode.Should().Be(403);
        getResult.Should().BeOfType<ObjectResult>().Which.StatusCode.Should().Be(403);
        updateResult.Should().BeOfType<ObjectResult>().Which.StatusCode.Should().Be(403);
        deactivateResult.Should().BeOfType<ObjectResult>().Which.StatusCode.Should().Be(403);
    }

    #endregion

    #region POST /api/staffs (CreateStaff)

    [Fact]
    public async Task CreateStaff_ShouldReturn201Created_WhenRequestIsValid()
    {
        // Arrange
        SetAdminUser();
        var staffId = Guid.NewGuid();
        var request = new CreateStaffRequest
        {
            Name = "Jane Registrar",
            Email = "jane@miu.edu",
            Password = "Password123!",
            Roles = ["REGISTRAR"]
        };

        var responseData = new StaffResponse
        {
            Id = staffId,
            Name = request.Name,
            Email = request.Email,
            Roles = request.Roles,
            Status = "ACTIVE",
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };

        _staffServiceMock.Setup(s => s.CreateStaffAsync(request, It.IsAny<CancellationToken>()))
            .ReturnsAsync(StaffResult<StaffResponse>.Success(responseData));

        // Act
        var result = await _controller.CreateStaff(request);

        // Assert
        result.Should().BeOfType<CreatedAtActionResult>();
        var createdResult = (CreatedAtActionResult)result;
        createdResult.StatusCode.Should().Be(201);
        createdResult.ActionName.Should().Be(nameof(StaffController.GetStaffById));
        createdResult.RouteValues!["id"].Should().Be(staffId);
        createdResult.Value.Should().BeEquivalentTo(responseData);
    }

    [Fact]
    public async Task CreateStaff_ShouldReturn409Conflict_WhenDuplicateEmail()
    {
        // Arrange
        SetAdminUser();
        var request = new CreateStaffRequest { Email = "duplicate@miu.edu" };
        _staffServiceMock.Setup(s => s.CreateStaffAsync(request, It.IsAny<CancellationToken>()))
            .ReturnsAsync(StaffResult<StaffResponse>.Conflict("A staff member with this email already exists."));

        // Act
        var result = await _controller.CreateStaff(request);

        // Assert
        result.Should().BeOfType<ConflictObjectResult>();
        var conflictResult = (ConflictObjectResult)result;
        conflictResult.StatusCode.Should().Be(409);
    }

    [Fact]
    public async Task CreateStaff_ShouldReturn400BadRequest_WhenPolicyViolationOrValidationFailed()
    {
        // Arrange
        SetAdminUser();
        var request = new CreateStaffRequest { Roles = ["REGISTRAR", "APPROVER"] };
        _staffServiceMock.Setup(s => s.CreateStaffAsync(request, It.IsAny<CancellationToken>()))
            .ReturnsAsync(StaffResult<StaffResponse>.PolicyViolation("Assigning both REGISTRAR and APPROVER roles is prohibited."));

        // Act
        var result = await _controller.CreateStaff(request);

        // Assert
        result.Should().BeOfType<BadRequestObjectResult>();
        var badRequestResult = (BadRequestObjectResult)result;
        badRequestResult.StatusCode.Should().Be(400);
    }

    [Fact]
    public async Task CreateStaff_ShouldReturn400BadRequest_WhenRequestBodyIsNull()
    {
        // Arrange
        SetAdminUser();

        // Act
        var result = await _controller.CreateStaff(null);

        // Assert
        result.Should().BeOfType<BadRequestObjectResult>();
    }

    #endregion

    #region GET /api/staffs (ListStaff)

    [Fact]
    public async Task ListStaff_ShouldReturn200OkWithList_WhenAuthorized()
    {
        // Arrange
        SetAdminUser();
        var staffList = new List<StaffResponse>
        {
            new() { Id = Guid.NewGuid(), Name = "Admin", Email = "admin@miu.edu", Roles = ["ADMIN"], Status = "ACTIVE" },
            new() { Id = Guid.NewGuid(), Name = "Registrar", Email = "reg@miu.edu", Roles = ["REGISTRAR"], Status = "ACTIVE" }
        };

        _staffServiceMock.Setup(s => s.ListStaffAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(StaffResult<IReadOnlyList<StaffResponse>>.Success(staffList));

        // Act
        var result = await _controller.ListStaff();

        // Assert
        result.Should().BeOfType<OkObjectResult>();
        var okResult = (OkObjectResult)result;
        okResult.StatusCode.Should().Be(200);
        okResult.Value.Should().BeEquivalentTo(staffList);
    }

    #endregion

    #region GET /api/staffs/{id} (GetStaffById)

    [Fact]
    public async Task GetStaffById_ShouldReturn200Ok_WhenStaffExists()
    {
        // Arrange
        SetAdminUser();
        var staffId = Guid.NewGuid();
        var staff = new StaffResponse
        {
            Id = staffId,
            Name = "John",
            Email = "john@miu.edu",
            Roles = ["ADMIN"],
            Status = "ACTIVE"
        };

        _staffServiceMock.Setup(s => s.GetStaffByIdAsync(staffId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(StaffResult<StaffResponse>.Success(staff));

        // Act
        var result = await _controller.GetStaffById(staffId);

        // Assert
        result.Should().BeOfType<OkObjectResult>();
        var okResult = (OkObjectResult)result;
        okResult.StatusCode.Should().Be(200);
        okResult.Value.Should().BeEquivalentTo(staff);
    }

    [Fact]
    public async Task GetStaffById_ShouldReturn404NotFound_WhenStaffDoesNotExist()
    {
        // Arrange
        SetAdminUser();
        var staffId = Guid.NewGuid();
        _staffServiceMock.Setup(s => s.GetStaffByIdAsync(staffId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(StaffResult<StaffResponse>.NotFound("Staff not found"));

        // Act
        var result = await _controller.GetStaffById(staffId);

        // Assert
        result.Should().BeOfType<NotFoundObjectResult>();
        var notFoundResult = (NotFoundObjectResult)result;
        notFoundResult.StatusCode.Should().Be(404);
    }

    #endregion

    #region PATCH /api/staffs/{id} (UpdateStaff)

    [Fact]
    public async Task UpdateStaff_ShouldReturn200Ok_WhenUpdateSucceeds()
    {
        // Arrange
        SetAdminUser();
        var staffId = Guid.NewGuid();
        var request = new UpdateStaffRequest { Name = "Updated Name" };
        var updatedResponse = new StaffResponse
        {
            Id = staffId,
            Name = "Updated Name",
            Email = "staff@miu.edu",
            Roles = ["REGISTRAR"],
            Status = "ACTIVE"
        };

        _staffServiceMock.Setup(s => s.UpdateStaffAsync(staffId, request, It.IsAny<CancellationToken>()))
            .ReturnsAsync(StaffResult<StaffResponse>.Success(updatedResponse));

        // Act
        var result = await _controller.UpdateStaff(staffId, request);

        // Assert
        result.Should().BeOfType<OkObjectResult>();
        var okResult = (OkObjectResult)result;
        okResult.StatusCode.Should().Be(200);
        okResult.Value.Should().BeEquivalentTo(updatedResponse);
    }

    [Fact]
    public async Task UpdateStaff_ShouldReturn404NotFound_WhenStaffDoesNotExist()
    {
        // Arrange
        SetAdminUser();
        var staffId = Guid.NewGuid();
        var request = new UpdateStaffRequest { Name = "Updated Name" };

        _staffServiceMock.Setup(s => s.UpdateStaffAsync(staffId, request, It.IsAny<CancellationToken>()))
            .ReturnsAsync(StaffResult<StaffResponse>.NotFound("Staff not found"));

        // Act
        var result = await _controller.UpdateStaff(staffId, request);

        // Assert
        result.Should().BeOfType<NotFoundObjectResult>();
    }

    [Fact]
    public async Task UpdateStaff_ShouldReturn409Conflict_WhenRemovingAdminRoleFromLastActiveAdmin()
    {
        // Arrange
        SetAdminUser();
        var staffId = Guid.NewGuid();
        var request = new UpdateStaffRequest { Roles = ["REGISTRAR"] };

        _staffServiceMock.Setup(s => s.UpdateStaffAsync(staffId, request, It.IsAny<CancellationToken>()))
            .ReturnsAsync(StaffResult<StaffResponse>.Conflict("Cannot remove the ADMIN role from the last remaining active administrator."));

        // Act
        var result = await _controller.UpdateStaff(staffId, request);

        // Assert
        result.Should().BeOfType<ConflictObjectResult>();
        var conflictResult = (ConflictObjectResult)result;
        conflictResult.StatusCode.Should().Be(409);
    }

    [Fact]
    public async Task UpdateStaff_ShouldReturn400BadRequest_WhenInvalidRoleCombination()
    {
        // Arrange
        SetAdminUser();
        var staffId = Guid.NewGuid();
        var request = new UpdateStaffRequest { Roles = ["REGISTRAR", "APPROVER"] };

        _staffServiceMock.Setup(s => s.UpdateStaffAsync(staffId, request, It.IsAny<CancellationToken>()))
            .ReturnsAsync(StaffResult<StaffResponse>.PolicyViolation("Assigning both REGISTRAR and APPROVER roles is prohibited."));

        // Act
        var result = await _controller.UpdateStaff(staffId, request);

        // Assert
        result.Should().BeOfType<BadRequestObjectResult>();
    }

    #endregion

    #region POST /api/staffs/{id}/deactivate (DeactivateStaff)

    [Fact]
    public async Task DeactivateStaff_ShouldReturn200Ok_WhenDeactivationSucceeds()
    {
        // Arrange
        SetAdminUser();
        var staffId = Guid.NewGuid();
        var response = new StaffResponse
        {
            Id = staffId,
            Name = "Jane Registrar",
            Email = "jane@miu.edu",
            Roles = ["REGISTRAR"],
            Status = "INACTIVE"
        };

        _staffServiceMock.Setup(s => s.DeactivateStaffAsync(staffId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(StaffResult<StaffResponse>.Success(response));

        // Act
        var result = await _controller.DeactivateStaff(staffId);

        // Assert
        result.Should().BeOfType<OkObjectResult>();
        var okResult = (OkObjectResult)result;
        okResult.StatusCode.Should().Be(200);
        okResult.Value.Should().BeEquivalentTo(response);
    }

    [Fact]
    public async Task DeactivateStaff_ShouldReturn409Conflict_WhenDeactivatingLastActiveAdmin()
    {
        // Arrange
        SetAdminUser();
        var staffId = Guid.NewGuid();

        _staffServiceMock.Setup(s => s.DeactivateStaffAsync(staffId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(StaffResult<StaffResponse>.Conflict("Cannot deactivate the last remaining active administrator."));

        // Act
        var result = await _controller.DeactivateStaff(staffId);

        // Assert
        result.Should().BeOfType<ConflictObjectResult>();
        var conflictResult = (ConflictObjectResult)result;
        conflictResult.StatusCode.Should().Be(409);
    }

    [Fact]
    public async Task DeactivateStaff_ShouldReturn404NotFound_WhenStaffDoesNotExist()
    {
        // Arrange
        SetAdminUser();
        var staffId = Guid.NewGuid();

        _staffServiceMock.Setup(s => s.DeactivateStaffAsync(staffId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(StaffResult<StaffResponse>.NotFound("Staff not found"));

        // Act
        var result = await _controller.DeactivateStaff(staffId);

        // Assert
        result.Should().BeOfType<NotFoundObjectResult>();
    }

    #endregion
}
